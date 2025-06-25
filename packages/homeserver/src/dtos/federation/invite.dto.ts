import { z } from 'zod';
import { RoomMemberEventDto } from '../common/event.dto';
import { EventIdDto, RoomIdDto } from '../common/validation.dto';

export const ProcessInviteParamsDto = z.object({
	roomId: RoomIdDto,
	eventId: EventIdDto,
});

export const ProcessInviteBodyDto = RoomMemberEventDto;

export const ProcessInviteResponseDto = z.object({
	event: ProcessInviteBodyDto,
});

export type ProcessInviteBody = z.infer<typeof ProcessInviteBodyDto>;
export type ProcessInviteResponse = z.infer<typeof ProcessInviteResponseDto>;