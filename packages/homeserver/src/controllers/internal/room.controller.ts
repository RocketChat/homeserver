import {
	Body,
	Controller,
	HttpException,
	HttpStatus,
	Param,
	Post,
	Put,
} from '@nestjs/common';
import { z } from 'zod';
import { RoomService } from '../../services/room.service';
import type { SignedEvent } from '../../signEvent';
import { ZodValidationPipe } from '../../validation/pipes/zod-validation.pipe';
import type { RoomTombstoneEvent } from '@hs/core/src/events/m.room.tombstone';

type TombstoneRoomResponseDto = SignedEvent<RoomTombstoneEvent>;

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

type UpdateRoomNameDto = z.infer<typeof UpdateRoomNameDtoSchema>;
type UpdateUserPowerLevelDto = z.infer<typeof UpdateUserPowerLevelSchema>;
type LeaveRoomDto = z.infer<typeof LeaveRoomDtoSchema>;
type KickUserDto = z.infer<typeof KickUserDtoSchema>;
type BanUserDto = z.infer<typeof BanUserDtoSchema>;

@Controller('internal/rooms')
export class InternalRoomController {
	constructor(private readonly roomService: RoomService) {}

	@Post('rooms')
	async createRoomEndpoint(
		@Body() body: {
			username: string;
			sender: string;
			name: string;
			canonical_alias?: string;
			alias?: string;
		},
	): Promise<unknown> {
		const { username, sender, name, canonical_alias, alias } = body;

		try {
			return this.roomService.createRoom(
				username,
				sender,
				name,
				canonical_alias,
				alias,
			);
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			throw new HttpException(
				`Failed to create room: ${error instanceof Error ? error.message : String(error)}`,
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	@Put('/:roomId/name')
	async updateRoomNameEndpoint(
		@Param(
			'roomId',
			new ZodValidationPipe(
				z
					.string()
					.trim()
					.min(1, { message: 'Room ID must be a non-empty string' }),
			),
		)
		roomId: string,
		@Body(new ZodValidationPipe(UpdateRoomNameDtoSchema))
		body: UpdateRoomNameDto,
	): Promise<{ eventId: string }> {
		const { name, senderUserId, targetServer } = body;

		try {
			const eventId = await this.roomService.updateRoomName(
				roomId.trim(),
				name,
				senderUserId,
				targetServer,
			);
			return { eventId };
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			throw new HttpException(
				`Failed to update room name: ${error instanceof Error ? error.message : String(error)}`,
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	@Put('/:roomId/permissions/:userId')
	async updateUserPowerLevel(
		@Param(
			'roomId',
			new ZodValidationPipe(
				z
					.string()
					.trim()
					.min(1, { message: 'Room ID must be a non-empty string' }),
			),
		)
		roomId: string,
		@Param(
			'userId',
			new ZodValidationPipe(
				z
					.string()
					.trim()
					.min(1, { message: 'User ID must be a non-empty string' }),
			),
		)
		userId: string,
		@Body(new ZodValidationPipe(UpdateUserPowerLevelSchema))
		body: UpdateUserPowerLevelDto,
	): Promise<{ eventId: string }> {
		try {
			const eventId = await this.roomService.updateUserPowerLevel(
				roomId,
				userId,
				body.powerLevel,
				body.senderUserId,
				body.targetServers,
			);
			return { eventId };
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			throw new HttpException(
				'Failed to update user power level.',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	@Post('/:roomId/leave')
	async leaveRoomEndpoint(
		@Param(
			'roomId',
			new ZodValidationPipe(
				z
					.string()
					.trim()
					.min(1, { message: 'Room ID must be a non-empty string' }),
			),
		)
		roomId: string,
		@Body(new ZodValidationPipe(LeaveRoomDtoSchema)) body: LeaveRoomDto,
	): Promise<{ eventId: string }> {
		const { senderUserId, targetServers } = body;

		try {
			const eventId = await this.roomService.leaveRoom(
				roomId.trim(),
				senderUserId,
				targetServers,
			);
			return { eventId };
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			throw new HttpException(
				`Failed to leave room: ${error instanceof Error ? error.message : String(error)}`,
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	@Post('/:roomId/members/:memberId/kick')
	async kickUserFromRoom(
		@Param(
			'roomId',
			new ZodValidationPipe(
				z
					.string()
					.trim()
					.min(1, { message: 'Room ID must be a non-empty string' }),
			),
		)
		roomId: string,
		@Param(
			'memberId',
			new ZodValidationPipe(
				z
					.string()
					.trim()
					.min(1, { message: 'Member ID must be a non-empty string' }),
			),
		)
		memberId: string,
		@Body(new ZodValidationPipe(KickUserDtoSchema)) body: KickUserDto,
	): Promise<{ eventId: string }> {
		const { senderUserId, reason, targetServers } = body;

		if (body.userIdToKick !== memberId) {
			throw new HttpException(
				'User ID in path does not match user ID in body (userIdToKick).',
				HttpStatus.BAD_REQUEST,
			);
		}

		try {
			const eventId = await this.roomService.kickUser(
				roomId.trim(),
				memberId,
				senderUserId,
				reason,
				targetServers,
			);
			return { eventId };
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			throw new HttpException(
				`Failed to kick user from room: ${error instanceof Error ? error.message : String(error)}`,
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	@Post('/:roomId/members/:memberId/ban')
	async banUserFromRoom(
		@Param(
			'roomId',
			new ZodValidationPipe(
				z
					.string()
					.trim()
					.min(1, { message: 'Room ID must be a non-empty string' }),
			),
		)
		roomId: string,
		@Param(
			'memberId',
			new ZodValidationPipe(
				z
					.string()
					.trim()
					.min(1, { message: 'Member ID must be a non-empty string' }),
			),
		)
		memberId: string,
		@Body(new ZodValidationPipe(BanUserDtoSchema)) body: BanUserDto,
	): Promise<{ eventId: string }> {
		const { senderUserId, reason, targetServers } = body;

		if (body.userIdToBan !== memberId) {
			throw new HttpException(
				'User ID in path does not match user ID in body (userIdToBan).',
				HttpStatus.BAD_REQUEST,
			);
		}

		try {
			const eventId = await this.roomService.banUser(
				roomId.trim(),
				memberId,
				senderUserId,
				reason,
				targetServers,
			);
			return { eventId };
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			throw new HttpException(
				`Failed to ban user from room: ${error instanceof Error ? error.message : String(error)}`,
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	@Post('rooms/:roomId/mark-room-as-tombstone')
	async markRoomAsTombstone(
		@Param('roomId', new ZodValidationPipe(RoomIdSchema)) roomId: string,
		@Body(new ZodValidationPipe(TombstoneRoomSchema)) body: TombstoneRoomDto,
	): Promise<TombstoneRoomResponseDto> {
		const { sender, reason, replacementRoomId } = body;

		try {
			return this.roomService.markRoomAsTombstone(
				roomId,
				sender,
				reason,
				replacementRoomId,
			);
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			throw new HttpException(
				`Failed to delete room: ${error instanceof Error ? error.message : String(error)}`,
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}
}
