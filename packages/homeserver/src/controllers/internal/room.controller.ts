import { Elysia } from 'elysia';
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
	UsernameDto
} from '../../dtos';
import { RoomService } from '../../services/room.service';

export const internalRoomPlugin = (app: Elysia) => {
	const roomService = container.resolve(RoomService);
	return app
		.post('/internal/rooms/rooms', async ({ body, set }): Promise<InternalCreateRoomResponse | ErrorResponse> => {
			const { username, sender, name, canonical_alias, alias } = body;
			return roomService.createRoom(
				username,
				sender,
				name,
				canonical_alias,
				alias,
			);
		}, {
			body: InternalCreateRoomBodyDto,
			response: {
				200: InternalCreateRoomResponseDto,
				400: ErrorResponseDto,
			},
			detail: {
				tags: ['Internal'],
				summary: 'Create a room',
				description: 'Create a room'
			}
		})
		.put('/internal/rooms/:roomId/name', async ({ params, body, set }): Promise<InternalUpdateRoomNameResponse | ErrorResponse> => {
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
		}, {
			params: InternalUpdateRoomNameParamsDto,
			body: InternalUpdateRoomNameBodyDto,
			response: {
				200: InternalRoomEventResponseDto,
				400: ErrorResponseDto,
			},
			detail: {
				tags: ['Internal'],
				summary: 'Update a room name',
				description: 'Update a room name'
			}
		})
		.put(
			'/internal/rooms/:roomId/permissions/:userId',
			async ({ params, body, set }): Promise<InternalUpdateUserPowerLevelResponse | ErrorResponse> => {
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
						roomIdParse.data,
						userIdParse.data,
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
			}, {
				params: InternalUpdateUserPowerLevelParamsDto,
				body: InternalUpdateUserPowerLevelBodyDto,
				response: {
					200: InternalRoomEventResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Update a user power level',
					description: 'Update a user power level'
				}
			}
		)
		.put('/internal/rooms/:roomId/leave', async ({ params, body, set }): Promise<InternalLeaveRoomResponse | ErrorResponse> => {
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
		}, {
			params: InternalLeaveRoomParamsDto,
			body: InternalLeaveRoomBodyDto,
			response: {
				200: InternalRoomEventResponseDto,
				400: ErrorResponseDto,
			},
			detail: {
				tags: ['Internal'],
				summary: 'Leave a room',
				description: 'Leave a room'
			}
		})
		.put(
			'/internal/rooms/:roomId/kick/:memberId',
			async ({ params, body, set }): Promise<InternalKickUserResponse | ErrorResponse> => {
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
				const { userIdToKick, senderUserId, reason, targetServers } =
					bodyParse.data;
				try {
					const eventId = await roomService.kickUser(
						roomIdParse.data,
						memberIdParse.data,
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
			}, {
				params: InternalKickUserParamsDto,
				body: InternalKickUserBodyDto,
				response: {
					200: InternalRoomEventResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Kick a user from a room',
					description: 'Kick a user from a room'
				}
			}
		)
		.put(
			'/internal/rooms/:roomId/ban/:userIdToBan',
			async ({ params, body, set }): Promise<InternalBanUserResponse | ErrorResponse> => {
				const roomIdParse = RoomIdDto.safeParse(params.roomId);
				const userIdParse = UsernameDto.safeParse(params.userIdToBan);
				const bodyParse = InternalBanUserBodyDto.safeParse(body);
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
				const { userIdToBan, senderUserId, reason, targetServers } =
					bodyParse.data;
				try {
					const eventId = await roomService.banUser(
						roomIdParse.data,
						userIdParse.data,
						senderUserId,
						reason,
						targetServers,
					);
					return { eventId };
				} catch (error) {
					set.status = 500;
					return {
						error: `Failed to ban user: ${error instanceof Error ? error.message : String(error)}`,
						details: {},
					};
				}
			}, {
				params: InternalBanUserParamsDto,
				body: InternalBanUserBodyDto,
				response: {
					200: InternalRoomEventResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Ban a user from a room',
					description: 'Ban a user from a room'
				}
			}
		)
		.put('/internal/rooms/:roomId/tombstone', async ({ params, body, set }): Promise<InternalTombstoneRoomResponse | ErrorResponse> => {
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
		}, {
			params: InternalTombstoneRoomParamsDto,
			body: InternalTombstoneRoomBodyDto,
			response: {
				200: InternalTombstoneRoomResponseDto,
				400: ErrorResponseDto,
			},
			detail: {
				tags: ['Internal'],
				summary: 'Tombstone a room',
				description: 'Tombstone a room'
			}
		});
};
