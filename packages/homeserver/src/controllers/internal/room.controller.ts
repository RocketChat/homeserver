import { PersistentEventFactory } from '@rocket.chat/federation-room';
import type { EventID, RoomID, UserID } from '@rocket.chat/federation-room';
import { federationSDK } from '@rocket.chat/federation-sdk';
import type { Elysia } from 'elysia';
import { t } from 'elysia';

import {
	type ErrorResponse,
	ErrorResponseDto,
	RoomIdDto,
	UsernameDto,
	InternalBanUserBodyDto,
	InternalBanUserParamsDto,
	type InternalBanUserResponse,
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
	return app
		.post(
			'/internal/rooms/rooms',
			async ({ body }): Promise<InternalCreateRoomResponse | ErrorResponse> => {
				const { creator, join_rule, name } = body;
				return federationSDK.createRoom(creator as UserID, name, join_rule);
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
			async ({ params, body, set }): Promise<InternalUpdateRoomNameResponse | ErrorResponse> => {
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
				return federationSDK.updateRoomName(roomIdParse.data as RoomID, name, senderUserId as UserID);
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
			async ({ params, body, set }): Promise<InternalUpdateUserPowerLevelResponse | ErrorResponse> => {
				const roomIdParse = RoomIdDto.safeParse(params.roomId);
				const userIdParse = UsernameDto.safeParse(params.userId);
				const bodyParse = InternalUpdateUserPowerLevelBodyDto.safeParse(body);
				if (!roomIdParse.success || !userIdParse.success || !bodyParse.success) {
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
					const eventId = await federationSDK.updateUserPowerLevel(
						params.roomId as RoomID,
						params.userId as UserID,
						powerLevel,
						senderUserId as UserID,
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
		.get(
			'/internal/rooms/:roomId/state',
			async ({ params, query }) => {
				const eventId = query.event_id;
				if (eventId) {
					const room = await federationSDK.findStateAtEvent(eventId as EventID);
					const state: Record<string, any> = {};
					for (const [key, value] of room.entries()) {
						state[key] = value.event;
					}
					return {
						...state,
					};
				}
				const room = await federationSDK.getLatestRoomState(params.roomId);
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
			async ({ params, body, set }): Promise<InternalLeaveRoomResponse | ErrorResponse> => {
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
					const eventId = await federationSDK.leaveRoom(roomIdParse.data as RoomID, senderUserId as UserID);
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
			async ({ params, body, set }): Promise<InternalKickUserResponse | ErrorResponse> => {
				const roomIdParse = RoomIdDto.safeParse(params.roomId);
				const memberIdParse = UsernameDto.safeParse(params.memberId);
				const bodyParse = InternalKickUserBodyDto.safeParse(body);
				if (!roomIdParse.success || !memberIdParse.success || !bodyParse.success) {
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
				const { /* userIdToKick, */ senderUserId, reason } = bodyParse.data;
				try {
					const eventId = await federationSDK.kickUser(params.roomId as RoomID, params.memberId as UserID, senderUserId as UserID, reason);
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
			async ({ params, body }): Promise<InternalBanUserResponse | ErrorResponse> => {
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

				const room = await federationSDK.getLatestRoomState(roomId);

				const createEvent = room.get('m.room.create:');

				if (!createEvent || !createEvent.isCreateEvent()) {
					throw new Error('Room create event not found');
				}

				const membershipEvent = PersistentEventFactory.newEvent<'m.room.member'>(
					{
						type: 'm.room.member',
						content: { membership: 'ban' },
						room_id: roomId as RoomID,
						state_key: userIdToBan as UserID,
						auth_events: [],
						depth: 0,
						prev_events: [],
						origin_server_ts: Date.now(),
						sender: senderUserId as UserID,
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

				await federationSDK.handlePdu(membershipEvent);

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
			async ({ params, body, set }): Promise<InternalTombstoneRoomResponse | ErrorResponse> => {
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
				return federationSDK.markRoomAsTombstone(
					roomIdParse.data as RoomID,
					bodyParse.data.sender as UserID,
					bodyParse.data.reason,
					bodyParse.data.replacementRoomId as RoomID,
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
			const roomIds = await federationSDK.getAllRoomIds();
			return {
				roomIds,
			};
		})
		.get('/internal/rooms/all/public', async () => {
			const publicRooms = await federationSDK.getAllPublicRoomIdsAndNames();
			return {
				publicRooms,
			};
		})
		.put(
			'/internal/rooms/:roomId/invite/:userId',
			async ({ params, body }) => {
				const { roomId, userId } = params;
				const { sender } = body;

				const resp = await federationSDK.inviteUserToRoom(userId as UserID, roomId as RoomID, sender as UserID);
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
