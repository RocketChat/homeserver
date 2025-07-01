import { type Static, t } from 'elysia';
import { RoomIdDto, UsernameDto } from '@hs/federation-sdk';

export const InternalInviteUserBodyDto = t.Object({
	username: t.String({
		minLength: 1,
		description: 'Username to invite',
	}),
	roomId: RoomIdDto,
	sender: UsernameDto,
});

export const InternalInviteUserResponseDto = t.Object({
	event_id: t.String({ description: 'Invite event ID' }),
	room_id: RoomIdDto,
});

export type InternalInviteUserBody = Static<typeof InternalInviteUserBodyDto>;
export type InternalInviteUserResponse = Static<
	typeof InternalInviteUserResponseDto
>;
