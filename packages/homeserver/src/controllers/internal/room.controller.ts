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
		.post('/internal/rooms/rooms', async ({ body }): Promise<InternalCreateRoomResponse | ErrorResponse> => {
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
		.put('/internal/rooms/:roomId/name', async ({ params, body }): Promise<InternalUpdateRoomNameResponse | ErrorResponse> => {
			const { name, senderUserId, targetServer } = body;
			return roomService.updateRoomName(
				params.roomId,
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
				const { senderUserId, powerLevel, targetServers } = body;
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
			const { senderUserId, targetServers } = body;
			try {
				const eventId = await roomService.leaveRoom(
					params.roomId,
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
				const { senderUserId, reason, targetServers } =
					body;
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
				const { senderUserId, reason, targetServers } = body;
				try {
					const eventId = await roomService.banUser(
						params.roomId,
						params.userIdToBan,
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
		.put('/internal/rooms/:roomId/tombstone', async ({ params, body }): Promise<InternalTombstoneRoomResponse | ErrorResponse> => {
			return roomService.markRoomAsTombstone(
				params.roomId,
				body.sender,
				body.reason,
				body.replacementRoomId,
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
