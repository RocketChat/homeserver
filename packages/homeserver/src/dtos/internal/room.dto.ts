import { z } from 'zod';
import { RoomIdDto, ServerNameDto, UsernameDto } from '../common/validation.dto';

export const InternalCreateRoomBodyDto = z.object({
	username: z.string()
		.min(1)
		.describe('Username for the room creator'),
	sender: UsernameDto,
	name: z.string()
		.min(1)
		.describe('Room name'),
	canonical_alias: z.string()
		.describe('Canonical alias for the room')
		.optional(),
	alias: z.string()
		.describe('Room alias')
		.optional(),
});

export const InternalCreateRoomResponseDto = z.object({
	room_id: RoomIdDto,
	event_id: z.string().describe('Creation event ID'),
});

export const InternalUpdateRoomNameParamsDto = z.object({
	roomId: RoomIdDto,
});

export const InternalUpdateRoomNameBodyDto = z.object({
	name: z.string()
		.min(1)
		.describe('New room name'),
	senderUserId: UsernameDto,
	targetServer: ServerNameDto,
});

export const InternalUpdateUserPowerLevelParamsDto = z.object({
	roomId: RoomIdDto,
	userId: UsernameDto,
});

export const InternalUpdateUserPowerLevelBodyDto = z.object({
	senderUserId: UsernameDto,
	powerLevel: z.number()
		.min(0)
		.max(100)
		.describe('Power level (0-100)'),
	targetServers: z.array(ServerNameDto).optional(),
});

export const InternalLeaveRoomParamsDto = z.object({
	roomId: RoomIdDto,
});

export const InternalLeaveRoomBodyDto = z.object({
	senderUserId: UsernameDto,
	targetServers: z.array(ServerNameDto).optional(),
});

export const InternalKickUserParamsDto = z.object({
	roomId: RoomIdDto,
	memberId: UsernameDto,
});

export const InternalKickUserBodyDto = z.object({
	userIdToKick: UsernameDto,
	senderUserId: UsernameDto,
	reason: z.string().describe('Reason for kicking').optional(),
	targetServers: z.array(ServerNameDto).optional(),
});

export const InternalBanUserParamsDto = z.object({
	roomId: RoomIdDto,
	userIdToBan: UsernameDto,
});

export const InternalBanUserBodyDto = z.object({
	userIdToBan: UsernameDto,
	senderUserId: UsernameDto,
	reason: z.string().describe('Reason for banning').optional(),
	targetServers: z.array(ServerNameDto).optional(),
});

export const InternalTombstoneRoomParamsDto = z.object({
	roomId: RoomIdDto,
});

export const InternalTombstoneRoomBodyDto = z.object({
	sender: UsernameDto,
	reason: z.string().describe('Reason for tombstoning').optional(),
	replacementRoomId: RoomIdDto.optional(),
});

export const InternalRoomEventResponseDto = z.object({
	eventId: z.string().describe('Event ID of the created event'),
});

export const InternalTombstoneRoomResponseDto = z.object({
	event_id: z.string().describe('Tombstone event ID'),
	origin_server_ts: z.number().describe('Server timestamp'),
	content: z.object({
		body: z.string(),
		replacement_room: RoomIdDto.optional(),
	}),
}); 

export type InternalCreateRoomBody = z.infer<typeof InternalCreateRoomBodyDto>;
export type InternalCreateRoomResponse = z.infer<typeof InternalCreateRoomResponseDto>;
export type InternalUpdateRoomNameParams = z.infer<typeof InternalUpdateRoomNameParamsDto>;
export type InternalUpdateRoomNameBody = z.infer<typeof InternalUpdateRoomNameBodyDto>;
export type InternalUpdateRoomNameResponse = z.infer<typeof InternalRoomEventResponseDto>;
export type InternalUpdateUserPowerLevelParams = z.infer<typeof InternalUpdateUserPowerLevelParamsDto>;
export type InternalUpdateUserPowerLevelBody = z.infer<typeof InternalUpdateUserPowerLevelBodyDto>;
export type InternalUpdateUserPowerLevelResponse = z.infer<typeof InternalRoomEventResponseDto>;
export type InternalLeaveRoomParams = z.infer<typeof InternalLeaveRoomParamsDto>;
export type InternalLeaveRoomBody = z.infer<typeof InternalLeaveRoomBodyDto>;
export type InternalLeaveRoomResponse = z.infer<typeof InternalRoomEventResponseDto>;
export type InternalKickUserParams = z.infer<typeof InternalKickUserParamsDto>;
export type InternalKickUserBody = z.infer<typeof InternalKickUserBodyDto>;
export type InternalKickUserResponse = z.infer<typeof InternalRoomEventResponseDto>;
export type InternalBanUserParams = z.infer<typeof InternalBanUserParamsDto>;
export type InternalBanUserBody = z.infer<typeof InternalBanUserBodyDto>;
export type InternalBanUserResponse = z.infer<typeof InternalRoomEventResponseDto>;
export type InternalTombstoneRoomParams = z.infer<typeof InternalTombstoneRoomParamsDto>;
export type InternalTombstoneRoomBody = z.infer<typeof InternalTombstoneRoomBodyDto>;
export type InternalTombstoneRoomResponse = z.infer<typeof InternalTombstoneRoomResponseDto>;