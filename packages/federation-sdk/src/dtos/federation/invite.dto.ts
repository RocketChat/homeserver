import { type Static, t } from 'elysia';
import { RoomMemberEventDto } from '../common/event.dto';
import { EventIdDto, RoomIdDto } from '../common/validation.dto';

export const ProcessInviteParamsDto = t.Object({
	roomId: RoomIdDto,
	eventId: EventIdDto,
});

export const ProcessInviteBodyDto = t.Object({
	event: RoomMemberEventDto,
	invite_room_state: t.Unknown({ description: 'Invite room state events' }),
	room_version: t.String({ description: 'Room version' }),
});

export const ProcessInviteResponseDto = t.Object({
	event: RoomMemberEventDto,
});

export type ProcessInviteBody = Static<typeof ProcessInviteBodyDto>;
export type ProcessInviteResponse = Static<typeof ProcessInviteResponseDto>;
