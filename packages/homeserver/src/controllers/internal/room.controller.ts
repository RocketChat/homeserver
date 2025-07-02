import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import {
	type InternalBanUserResponse,
	type InternalCreateRoomResponse,
	type InternalKickUserResponse,
	type InternalLeaveRoomResponse,
	type InternalTombstoneRoomResponse,
	type InternalUpdateRoomNameResponse,
	type InternalUpdateUserPowerLevelResponse,
	InternalBanUserBodyDto,
	InternalBanUserParamsDto,
	InternalCreateRoomBodyDto,
	InternalCreateRoomResponseDto,
	InternalKickUserBodyDto,
	InternalKickUserParamsDto,
	InternalLeaveRoomBodyDto,
	InternalLeaveRoomParamsDto,
	InternalRoomEventResponseDto,
	InternalTombstoneRoomBodyDto,
	InternalTombstoneRoomParamsDto,
	InternalTombstoneRoomResponseDto,
	InternalUpdateRoomNameBodyDto,
	InternalUpdateRoomNameParamsDto,
	InternalUpdateUserPowerLevelBodyDto,
	InternalUpdateUserPowerLevelParamsDto,
} from '../../dtos';
import {
	type ErrorResponse,
	ErrorResponseDto,
	RoomIdDto,
	UsernameDto,
} from '@hs/federation-sdk';

import { PersistentEventFactory } from '@hs/room';
import type { PduCreateEventContent } from '@hs/room';
import { RoomService } from '@hs/federation-sdk';
import { StateService } from '@hs/federation-sdk';
import { ConfigService } from '@hs/federation-sdk';
import { FederationService } from '@hs/federation-sdk';
import { PersistentEventBase } from '@hs/room';
import { RoomVersion } from '@hs/room';

export const internalRoomPlugin = (app: Elysia) => {
	const roomService = container.resolve(RoomService);
	const stateService = container.resolve(StateService);
	const configService = container.resolve(ConfigService);
	const federationService = container.resolve(FederationService);
	return app
		.post(
			'/internal/rooms/rooms',
			async ({
				body,
				set,
			}): Promise<InternalCreateRoomResponse | ErrorResponse> => {
				const { username, sender, name, canonical_alias, alias } = body;
				return roomService.createRoom(
					username,
					sender,
					name,
					body.join_rule as any,
					'11',
					canonical_alias,
					alias,
				);
			},
			{
				body: InternalCreateRoomBodyDto,
				response: {
					200: InternalCreateRoomResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Create a room',
					description: 'Create a room',
				},
			},
		)
		.put(
			'/internal/rooms/:roomId/name',
			async ({
				params,
				body,
				set,
			}): Promise<InternalUpdateRoomNameResponse | ErrorResponse> => {
				const roomIdParse = RoomIdDto.safeParse(params.roomId);
				const bodyParse = InternalUpdateRoomNameBodyDto.safeParse(body);
				if (!roomIdParse.success || !bodyParse.success) {
					set.status = 400;
					return {
						error: 'Invalid request',
						details: {
							roomId: roomIdParse.error?.flatten(),
							body: bodyParse.error?.flatten(),
						},
					};
				}
				const { name, senderUserId, targetServer } = bodyParse.data;
				return roomService.updateRoomName(
					roomIdParse.data,
					name,
					senderUserId,
					targetServer,
				);
			},
			{
				params: InternalUpdateRoomNameParamsDto,
				body: InternalUpdateRoomNameBodyDto,
				response: {
					200: InternalRoomEventResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Update a room name',
					description: 'Update a room name',
				},
			},
		)
		.put(
			'/internal/rooms/:roomId/permissions/:userId',
			async ({
				params,
				body,
				set,
			}): Promise<InternalUpdateUserPowerLevelResponse | ErrorResponse> => {
				const roomIdParse = RoomIdDto.safeParse(params.roomId);
				const userIdParse = UsernameDto.safeParse(params.userId);
				const bodyParse = InternalUpdateUserPowerLevelBodyDto.safeParse(body);
				if (
					!roomIdParse.success ||
					!userIdParse.success ||
					!bodyParse.success
				) {
					set.status = 400;
					return {
						error: 'Invalid request',
						details: {
							roomId: roomIdParse.error?.flatten(),
							userId: userIdParse.error?.flatten(),
							body: bodyParse.error?.flatten(),
						},
					};
				}
				const { senderUserId, powerLevel, targetServers } = bodyParse.data;
				try {
					const eventId = await roomService.updateUserPowerLevel(
						params.roomId,
						params.userId,
						powerLevel,
						senderUserId,
						targetServers,
					);
					return { eventId };
				} catch (error) {
					set.status = 500;
					return {
						error: `Failed to update user power level: ${error instanceof Error ? error.message : String(error)}`,
						details: {},
					};
				}
			},
			{
				params: InternalUpdateUserPowerLevelParamsDto,
				body: InternalUpdateUserPowerLevelBodyDto,
				response: {
					200: InternalRoomEventResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Update a user power level',
					description: 'Update a user power level',
				},
			},
		)
		.put(
			'/internal/rooms/:roomId/join/:userId',
			async ({ params, body }) => {
				const { roomId, userId } = params;
				const { senderUserId } = body;

				const residentServer = roomId.split(':').pop();
				if (residentServer === configService.getServerName()) {
					const room = await stateService.getFullRoomState(roomId);

					const createEvent = room.get('m.room.create:');

					if (!createEvent) {
						throw new Error('Room create event not found');
					}

					const membershipEvent = PersistentEventFactory.newMembershipEvent(
						roomId,
						senderUserId,
						userId,
						'join',
						createEvent.getContent<PduCreateEventContent>(),
					);

					const statesNeeded = membershipEvent.getAuthEventStateKeys();

					for (const state of statesNeeded) {
						const event = room.get(state);
						if (event) {
							membershipEvent.authedBy(event);
						}
					}

					for await (const prevEvent of stateService.getPrevEvents(
						membershipEvent,
					)) {
						membershipEvent.addPreviousEvent(prevEvent);
					}

					await stateService.persistStateEvent(membershipEvent);

					if (membershipEvent.rejected) {
						throw new Error(membershipEvent.rejectedReason);
					}

					return {
						eventId: membershipEvent.eventId,
					};
				}

				// trying to join room from another server
				const makeJoinResponse = await federationService.makeJoin(
					residentServer as string,
					roomId,
					userId,
					'10',
				);

				const joinEvent = PersistentEventFactory.createFromRawEvent(
					makeJoinResponse.event as any,
					makeJoinResponse.room_version,
				);

				// TODO: sign the event here
				// currently makeSignedRequest does the signing
				const sendJoinResponse = await federationService.sendJoin(joinEvent);

				// TODO: validate hash and sig
				// run through state res
				// validate all auth chain events
				const eventMap = new Map<string, PersistentEventBase>();

				for (const stateEvent_ of sendJoinResponse.state) {
					const stateEvent = PersistentEventFactory.createFromRawEvent(
						stateEvent_ as any,
						makeJoinResponse.room_version,
					);

					eventMap.set(stateEvent.eventId, stateEvent);
				}

				const persistEvent = async (event: PersistentEventBase) => {
					if (event.event.auth_events.length === 0) {
						// persist as normal
						console.log('persisting as normal', event.eventId, event.event);
						await stateService.persistStateEvent(event);
						return;
					}

					for (const authEventId of event.event.auth_events) {
						const authEvent = eventMap.get(authEventId as string);
						if (!authEvent) {
							for (const stateEvent of eventMap.keys()) {
								console.log(
									`${stateEvent} -> ${JSON.stringify(eventMap.get(stateEvent)?.event, null, 2)}`,
								);
							}
							throw new Error(`Auth event ${authEventId} not found`);
						}

						await persistEvent(authEvent);
					}

					console.log('persisting as auth event', event.eventId, event.event);
					// persist as normal
					await stateService.persistStateEvent(event);
				};

				for (const stateEvent of eventMap.values()) {
					await persistEvent(stateEvent);
				}

				await stateService.persistStateEvent(
					PersistentEventFactory.createFromRawEvent(
						sendJoinResponse.event as any,
						makeJoinResponse.room_version,
					),
				);

				return {
					eventId: sendJoinResponse.event_id,
				};
			},
			{
				// params: InternalJoinRoomParamsDto,
				body: t.Object({
					senderUserId: t.String(),
				}),
				// response: {
				// 	200: InternalRoomEventResponseDto,
				// 	400: ErrorResponseDto,
				// },
				detail: {
					tags: ['Internal'],
					summary: 'Join a room',
					description: 'Join a room',
				},
			},
		)
		.get(
			'/internal/rooms/:roomId/state',
			async ({ params, query }) => {
				const eventId = query.event_id;
				if (eventId) {
					const room = await stateService.findStateAtEvent(eventId);
					const state: Record<string, any> = {};
					for (const [key, value] of room.entries()) {
						state[key] = value.event;
					}
					return {
						...state,
					};
				}
				const room = await stateService.getFullRoomState(params.roomId);
				const state: Record<string, any> = {};
				for (const [key, value] of room.entries()) {
					state[key] = value.event;
				}
				return {
					...state,
				};
			},
			{
				detail: {
					tags: ['Internal'],
					summary: 'Get the state of a room',
					description: 'Get the state of a room',
				},
			},
		)
		.put(
			'/internal/rooms/:roomId/leave',
			async ({
				params,
				body,
				set,
			}): Promise<InternalLeaveRoomResponse | ErrorResponse> => {
				const roomIdParse = RoomIdDto.safeParse(params.roomId);
				const bodyParse = InternalLeaveRoomBodyDto.safeParse(body);
				if (!roomIdParse.success || !bodyParse.success) {
					set.status = 400;
					return {
						error: 'Invalid request',
						details: {
							roomId: roomIdParse.error?.flatten(),
							body: bodyParse.error?.flatten(),
						},
					};
				}
				const { senderUserId, targetServers } = bodyParse.data;
				try {
					const eventId = await roomService.leaveRoom(
						roomIdParse.data,
						senderUserId,
						targetServers,
					);
					return { eventId };
				} catch (error) {
					set.status = 500;
					return {
						error: `Failed to leave room: ${error instanceof Error ? error.message : String(error)}`,
						details: {},
					};
				}
			},
			{
				params: InternalLeaveRoomParamsDto,
				body: InternalLeaveRoomBodyDto,
				response: {
					200: InternalRoomEventResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Leave a room',
					description: 'Leave a room',
				},
			},
		)
		.put(
			'/internal/rooms/:roomId/kick/:memberId',
			async ({
				params,
				body,
				set,
			}): Promise<InternalKickUserResponse | ErrorResponse> => {
				const roomIdParse = RoomIdDto.safeParse(params.roomId);
				const memberIdParse = UsernameDto.safeParse(params.memberId);
				const bodyParse = InternalKickUserBodyDto.safeParse(body);
				if (
					!roomIdParse.success ||
					!memberIdParse.success ||
					!bodyParse.success
				) {
					set.status = 400;
					return {
						error: 'Invalid request',
						details: {
							roomId: roomIdParse.error?.flatten(),
							memberId: memberIdParse.error?.flatten(),
							body: bodyParse.error?.flatten(),
						},
					};
				}
				const { /*userIdToKick, */ senderUserId, reason, targetServers } =
					bodyParse.data;
				try {
					const eventId = await roomService.kickUser(
						params.roomId,
						params.memberId,
						senderUserId,
						reason,
						targetServers,
					);
					return { eventId };
				} catch (error) {
					set.status = 500;
					return {
						error: `Failed to kick user: ${error instanceof Error ? error.message : String(error)}`,
						details: {},
					};
				}
			},
			{
				params: InternalKickUserParamsDto,
				body: InternalKickUserBodyDto,
				response: {
					200: InternalRoomEventResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Kick a user from a room',
					description: 'Kick a user from a room',
				},
			},
		)
		.put(
			'/internal/rooms/:roomId/ban/:userIdToBan',
			async ({
				params,
				body,
			}): Promise<InternalBanUserResponse | ErrorResponse> => {
				// const roomIdParse = RoomIdDto.safeParse(params.roomId);
				// const userIdParse = UsernameDto.safeParse(params.userIdToBan);
				// const bodyParse = InternalBanUserBodyDto.safeParse(body);
				// if (
				// 	!roomIdParse.success ||
				// 	!userIdParse.success ||
				// 	!bodyParse.success
				// ) {
				// 	set.status = 400;
				// 	return {
				// 		error: 'Invalid request',
				// 		details: {
				// 			roomId: roomIdParse.error?.flatten(),
				// 			userId: userIdParse.error?.flatten(),
				// 			body: bodyParse.error?.flatten(),
				// 		},
				// 	};
				// }
				// const { userIdToBan, senderUserId, reason, targetServers } =
				// 	bodyParse.data;
				// try {
				// 	const eventId = await roomService.banUser(
				// 		roomIdParse.data,
				// 		userIdParse.data,
				// 		senderUserId,
				// 		reason,
				// 		targetServers,
				// 	);
				// 	return { eventId };
				// } catch (error) {
				// 	set.status = 500;
				// 	return {
				// 		error: `Failed to ban user: ${error instanceof Error ? error.message : String(error)}`,
				// 		details: {},
				// 	};
				// }

				const { roomId, userIdToBan } = params;
				const { senderUserId } = body;

				const room = await stateService.getFullRoomState(roomId);

				const createEvent = room.get('m.room.create:');

				if (!createEvent) {
					throw new Error('Room create event not found');
				}

				const membershipEvent = PersistentEventFactory.newMembershipEvent(
					roomId,
					senderUserId,
					userIdToBan,
					'ban',
					createEvent.getContent<PduCreateEventContent>(),
				);

				const statesNeeded = membershipEvent.getAuthEventStateKeys();

				for (const state of statesNeeded) {
					const event = room.get(state);
					if (event) {
						membershipEvent.authedBy(event);
					}
				}

				await stateService.persistStateEvent(membershipEvent);

				return {
					eventId: membershipEvent.eventId,
				};
			},
			{
				params: InternalBanUserParamsDto,
				body: InternalBanUserBodyDto,
				response: {
					200: InternalRoomEventResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Ban a user from a room',
					description: 'Ban a user from a room',
				},
			},
		)
		.put(
			'/internal/rooms/:roomId/tombstone',
			async ({
				params,
				body,
				set,
			}): Promise<InternalTombstoneRoomResponse | ErrorResponse> => {
				const roomIdParse = RoomIdDto.safeParse(params.roomId);
				const bodyParse = InternalTombstoneRoomBodyDto.safeParse(body);
				if (!roomIdParse.success || !bodyParse.success) {
					set.status = 400;
					return {
						error: 'Invalid request',
						details: {
							roomId: roomIdParse.error?.flatten(),
							body: bodyParse.error?.flatten(),
						},
					};
				}
				return roomService.markRoomAsTombstone(
					roomIdParse.data,
					bodyParse.data.sender,
					bodyParse.data.reason,
					bodyParse.data.replacementRoomId,
				);
			},
			{
				params: InternalTombstoneRoomParamsDto,
				body: InternalTombstoneRoomBodyDto,
				response: {
					200: InternalTombstoneRoomResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Tombstone a room',
					description: 'Tombstone a room',
				},
			},
		)
		.get('/internal/rooms/all', async () => {
			const roomIds = await stateService.getAllRoomIds();
			return {
				roomIds,
			};
		})
		.get('/internal/rooms/all/public', async () => {
			const publicRooms = await stateService.getAllPublicRoomIdsAndNames();
			return {
				publicRooms,
			};
		})
		.put(
			'/internal/rooms/:roomId/invite/:userId',
			async ({ params, body, set }) => {
				const { roomId, userId } = params;
				const { sender } = body;

				const roomInformation = await stateService.getRoomInformation(roomId);

				const inviteEvent = PersistentEventFactory.newMembershipEvent(
					roomId,
					sender,
					userId,
					'invite',
					roomInformation,
				);

				for await (const authEvent of stateService.getAuthEvents(inviteEvent)) {
					inviteEvent.authedBy(authEvent);
				}

				for await (const prevEvent of stateService.getPrevEvents(inviteEvent)) {
					inviteEvent.addPreviousEvent(prevEvent);
				}

				await stateService.signEvent(inviteEvent);

				const inviteResponse = await federationService.inviteUser(
					inviteEvent,
					roomInformation.room_version,
				);

				console.log(inviteResponse);

				await stateService.persistStateEvent(
					PersistentEventFactory.createFromRawEvent(
						inviteResponse.event as any,
						roomInformation.room_version as RoomVersion,
					),
				);

				return {
					eventId: inviteEvent.eventId,
				};
			},
			{
				body: t.Object({
					sender: t.String(),
				}),
			},
		);
};
