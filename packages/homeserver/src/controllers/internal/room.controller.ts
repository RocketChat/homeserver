import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import {
	type ErrorResponse,
	type InternalBanUserResponse,
	type InternalCreateRoomResponse,
	type InternalKickUserResponse,
	type InternalLeaveRoomResponse,
	type InternalTombstoneRoomResponse,
	type InternalUpdateRoomNameResponse,
	type InternalUpdateUserPowerLevelResponse,
	ErrorResponseDto,
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
	RoomIdDto,
	UsernameDto,
} from '@hs/federation-sdk/src/dtos';
import { RoomService } from '@hs/federation-sdk/src/services/room.service';
import { PersistentEventFactory } from '@hs/room/src/manager/factory';
import { StateService } from '@hs/federation-sdk/src/services/state.service';
import type { PduCreateEventContent } from '@hs/room/src/types/v1';

export const internalRoomPlugin = (app: Elysia) => {
	const roomService = container.resolve(RoomService);
	const stateService = container.resolve(StateService);
	return app
		.post(
			'/internal/rooms/rooms',
			async ({ body }): Promise<InternalCreateRoomResponse | ErrorResponse> => {
				const { username, name /*sender , canonical_alias, alias*/ } = body;
				// return roomService.createRoom(
				// 	username,
				// 	sender,
				// 	name,
				// 	canonical_alias,
				// 	alias,
				// );

				const roomCreateEvent = PersistentEventFactory.newCreateEvent(
					username,
					'11',
				);

				await stateService.persistStateEvent(roomCreateEvent);

				const creatorMembershipEvent =
					PersistentEventFactory.newMembershipEvent(
						roomCreateEvent.roomId,
						username,
						username,
						'join',
						roomCreateEvent.getContent<PduCreateEventContent>(),
					);

				creatorMembershipEvent
					.addPreviousEvent(roomCreateEvent)
					.authedBy(roomCreateEvent);

				await stateService.persistStateEvent(creatorMembershipEvent);

				const roomNameEvent = PersistentEventFactory.newRoomNameEvent(
					roomCreateEvent.roomId,
					username,
					name,
					'11',
				);

				roomNameEvent
					.addPreviousEvent(creatorMembershipEvent)
					.authedBy(creatorMembershipEvent)
					.authedBy(roomCreateEvent);

				await stateService.persistStateEvent(roomNameEvent);

				const powerLevelEvent = PersistentEventFactory.newPowerLevelEvent(
					roomCreateEvent.roomId,
					username,
					{
						users: {
							[username]: 100,
						},
						users_default: 0,
						events: {},
						events_default: 0,
						state_default: 50,
						ban: 50,
						kick: 50,
						redact: 50,
						invite: 50,
					},
					'11',
				);

				powerLevelEvent
					.addPreviousEvent(creatorMembershipEvent)
					.authedBy(creatorMembershipEvent)
					.authedBy(roomCreateEvent);

				await stateService.persistStateEvent(powerLevelEvent);

				return {
					room_id: roomCreateEvent.roomId,
					event_id: roomCreateEvent.eventId,
				};
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

				await stateService.persistStateEvent(membershipEvent);

				if (membershipEvent.rejected) {
					throw new Error(membershipEvent.rejectedReason);
				}

				return {
					eventId: membershipEvent.eventId,
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

				console.log('createEvent', createEvent);

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
		});
};
