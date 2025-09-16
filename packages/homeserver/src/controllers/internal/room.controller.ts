import { RoomService } from '@hs/federation-sdk';
import { StateService } from '@hs/federation-sdk';
import { InviteService } from '@hs/federation-sdk';
import { type PduCreateEventContent, PersistentEventFactory } from '@hs/room';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import {
	type ErrorResponse,
	ErrorResponseDto,
	RoomIdDto,
	UsernameDto,
} from '../../dtos';
import {
	InternalBanUserBodyDto,
	InternalBanUserParamsDto,
	type InternalBanUserResponse,
	InternalCreateRoomBodyDto,
	type InternalCreateRoomResponse,
	InternalCreateRoomResponseDto,
	InternalKickUserBodyDto,
	InternalKickUserParamsDto,
	type InternalKickUserResponse,
	InternalLeaveRoomBodyDto,
	InternalLeaveRoomParamsDto,
	type InternalLeaveRoomResponse,
	InternalRoomEventResponseDto,
	InternalTombstoneRoomBodyDto,
	InternalTombstoneRoomParamsDto,
	type InternalTombstoneRoomResponse,
	InternalTombstoneRoomResponseDto,
	InternalUpdateRoomNameBodyDto,
	InternalUpdateRoomNameParamsDto,
	type InternalUpdateRoomNameResponse,
	InternalUpdateUserPowerLevelBodyDto,
	InternalUpdateUserPowerLevelParamsDto,
	type InternalUpdateUserPowerLevelResponse,
} from '../../dtos';

export const internalRoomPlugin = (app: Elysia) => {
	const roomService = container.resolve(RoomService);
	const stateService = container.resolve(StateService);
	const inviteService = container.resolve(InviteService);
	return app
		.post(
			'/internal/rooms/rooms',
			async ({ body }): Promise<InternalCreateRoomResponse | ErrorResponse> => {
				const { creator, join_rule, name } = body;
				return roomService.createRoom(creator, name, join_rule);
			},
			{
				body: t.Object({
					creator: t.String(),
					name: t.String(),
					join_rule: t.Union([t.Literal('public'), t.Literal('invite')]),
				}),
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
				const { name, senderUserId } = bodyParse.data;
				return roomService.updateRoomName(roomIdParse.data, name, senderUserId);
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
				const { senderUserId, powerLevel } = bodyParse.data;
				try {
					const eventId = await roomService.updateUserPowerLevel(
						params.roomId,
						params.userId,
						powerLevel,
						senderUserId,
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
			async ({ params }) => {
				const { roomId, userId } = params;

				const eventId = await roomService.joinUser(roomId, userId);

				return {
					eventId,
				};
			},
			{
				// params: InternalJoinRoomParamsDto,
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
				const { senderUserId } = bodyParse.data;
				try {
					const eventId = await roomService.leaveRoom(
						roomIdParse.data,
						senderUserId,
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
				const { /*userIdToKick, */ senderUserId, reason } = bodyParse.data;
				try {
					const eventId = await roomService.kickUser(
						params.roomId,
						params.memberId,
						senderUserId,
						reason,
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

				if (!createEvent || !createEvent.isCreateEvent()) {
					throw new Error('Room create event not found');
				}

				const membershipEvent =
					PersistentEventFactory.newEvent<'m.room.member'>(
						{
							type: 'm.room.member',
							content: { membership: 'ban' },
							room_id: roomId,
							state_key: userIdToBan,
							auth_events: [],
							depth: 0,
							prev_events: [],
							origin_server_ts: Date.now(),
							sender: senderUserId,
						},
						createEvent.getContent().room_version,
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
			async ({ params, body }) => {
				const { roomId, userId } = params;
				const { sender } = body;

				const resp = await inviteService.inviteUserToRoom(
					userId,
					roomId,
					sender,
				);
				return {
					eventId: resp.event_id,
				};
			},
			{
				body: t.Object({
					sender: t.String(),
				}),
			},
		);
};
