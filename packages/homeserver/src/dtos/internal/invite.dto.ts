import { z } from 'zod';
import { RoomIdDto, UsernameDto } from '../common/validation.dto';

export const InternalInviteUserBodyDto = z.object({
	username: z.string()
		.min(1)
		.describe('Username to invite'),
	roomId: RoomIdDto.optional(),
	sender: UsernameDto.optional(),
	name: z.string()
		.min(1)
		.describe('Room or user name'),
});

export const InternalInviteUserResponseDto = z.object({
	event_id: z.string().describe('Invite event ID'),
	room_id: RoomIdDto,
}); 

export type InternalInviteUserBody = z.infer<typeof InternalInviteUserBodyDto>;
export type InternalInviteUserResponse = z.infer<typeof InternalInviteUserResponseDto>;