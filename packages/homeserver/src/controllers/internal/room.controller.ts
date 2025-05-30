import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { z } from 'zod';
import { RoomService } from '../../services/room.service';
import type { SignedEvent } from '../../signEvent';
import type { RoomTombstoneEvent } from '@hs/core/src/events/m.room.tombstone';

const TombstoneRoomSchema = z.object({
	sender: z
		.string()
		.startsWith('@')
		.refine((val) => val.includes(':'), {
			message: 'Sender must be in the format @user:server.com',
		}),
	reason: z.string().optional(),
	replacementRoomId: z
		.string()
		.startsWith('!')
		.refine((val) => val.includes(':'), {
			message: 'Replacement room ID must be in the format !room:server.com',
		})
		.optional(),
});

type TombstoneRoomDto = z.infer<typeof TombstoneRoomSchema>;

type TombstoneRoomResponseDto = SignedEvent<RoomTombstoneEvent>;

const RoomIdSchema = z
	.string()
	.startsWith('!')
	.refine((val) => val.includes(':'), {
		message: 'Room ID must be in the format !room:server.com',
	});

const UpdateRoomNameDtoSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, { message: 'Room name must be a non-empty string' }),
	senderUserId: z
		.string()
		.trim()
		.min(1, { message: 'Sender ID must be a non-empty string' }),
	targetServer: z
		.string()
		.trim()
		.min(1, { message: 'Target server must be a non-empty string' }),
});

const UpdateUserPowerLevelSchema = z.object({
	senderUserId: z.string().min(1),
	powerLevel: z.number().int(),
	targetServers: z.array(z.string()).optional(),
});

const LeaveRoomDtoSchema = z.object({
	senderUserId: z
		.string()
		.trim()
		.min(1, { message: 'Sender ID must be a non-empty string' }),
	targetServers: z.array(z.string()).optional(),
});

const KickUserDtoSchema = z.object({
	userIdToKick: z
		.string()
		.trim()
		.min(1, { message: 'User ID to kick must be a non-empty string' }),
	senderUserId: z
		.string()
		.trim()
		.min(1, { message: 'Sender ID must be a non-empty string' }),
	reason: z.string().optional(),
	targetServers: z.array(z.string()).optional(),
});

const BanUserDtoSchema = z.object({
	userIdToBan: z
		.string()
		.trim()
		.min(1, { message: 'User ID to ban must be a non-empty string' }),
	senderUserId: z
		.string()
		.trim()
		.min(1, { message: 'Sender ID must be a non-empty string' }),
	reason: z.string().optional(),
	targetServers: z.array(z.string()).optional(),
});

export const internalRoomPlugin = (app: Elysia) => {
	const roomService = container.resolve(RoomService);
	return app
		.post('/internal/rooms/rooms', async ({ body, set }) => {
			const { username, sender, name, canonical_alias, alias } = body as {
				username: string;
				sender: string;
				name: string;
				canonical_alias?: string;
				alias?: string;
			};
			try {
				return await roomService.createRoom(
					username,
					sender,
					name,
					canonical_alias,
					alias,
				);
			} catch (error) {
				set.status = 500;
				return {
					error: `Failed to create room: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		})
		.put('/internal/rooms/:roomId/name', async ({ params, body, set }) => {
			const idParse = z.string().trim().min(1).safeParse(params.roomId);
			const bodyParse = UpdateRoomNameDtoSchema.safeParse(body);
			if (!idParse.success || !bodyParse.success) {
				set.status = 400;
				return {
					error: 'Invalid request',
					details: {
						id: idParse.error?.flatten(),
						body: bodyParse.error?.flatten(),
					},
				};
			}
			const { name, senderUserId, targetServer } = bodyParse.data;
			try {
				const eventId = await roomService.updateRoomName(
					idParse.data,
					name,
					senderUserId,
					targetServer,
				);
				return { eventId };
			} catch (error) {
				set.status = 500;
				return {
					error: `Failed to update room name: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		})
		.put(
			'/internal/rooms/:roomId/permissions/:userId',
			async ({ params, body, set }) => {
				const roomIdParse = z.string().trim().min(1).safeParse(params.roomId);
				const userIdParse = z.string().trim().min(1).safeParse(params.userId);
				const bodyParse = UpdateUserPowerLevelSchema.safeParse(body);
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
					};
				}
			},
		)
		.put('/internal/rooms/:roomId/leave', async ({ params, body, set }) => {
			const roomIdParse = z.string().trim().min(1).safeParse(params.roomId);
			const bodyParse = LeaveRoomDtoSchema.safeParse(body);
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
				};
			}
		})
		.put(
			'/internal/rooms/:roomId/kick/:memberId',
			async ({ params, body, set }) => {
				const roomIdParse = z.string().trim().min(1).safeParse(params.roomId);
				const memberIdParse = z
					.string()
					.trim()
					.min(1)
					.safeParse(params.memberId);
				const bodyParse = KickUserDtoSchema.safeParse(body);
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
					};
				}
			},
		)
		.put(
			'/internal/rooms/:roomId/ban/:memberId',
			async ({ params, body, set }) => {
				const roomIdParse = z.string().trim().min(1).safeParse(params.roomId);
				const memberIdParse = z
					.string()
					.trim()
					.min(1)
					.safeParse(params.memberId);
				const bodyParse = BanUserDtoSchema.safeParse(body);
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
				const { userIdToBan, senderUserId, reason, targetServers } =
					bodyParse.data;
				try {
					const eventId = await roomService.banUser(
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
						error: `Failed to ban user: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			},
		)
		.put('/internal/rooms/:roomId/tombstone', async ({ params, body, set }) => {
			const roomIdParse = RoomIdSchema.safeParse(params.roomId);
			const bodyParse = TombstoneRoomSchema.safeParse(body);
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
			try {
				return await roomService.markRoomAsTombstone(
					roomIdParse.data,
					bodyParse.data.sender,
					bodyParse.data.reason,
					bodyParse.data.replacementRoomId,
				);
			} catch (error) {
				set.status = 500;
				return {
					error: `Failed to tombstone room: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		});
};
