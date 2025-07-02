import { z } from 'zod';
import { EventBaseDto, MembershipEventContentDto } from '../common/event.dto';
import { EventIdDto, RoomIdDto, ServerNameDto, UsernameDto } from '../common/validation.dto';

export const SendJoinParamsDto = z.object({
	roomId: RoomIdDto,
	stateKey: EventIdDto,
});

export const SendJoinEventDto = EventBaseDto.merge(
	z.object({
		type: z.literal('m.room.member'),
		content: MembershipEventContentDto.merge(
			z.object({
				membership: z.literal('join'),
			})
		),
		state_key: UsernameDto, // Using UsernameDto since it should be a user ID
	})
);

export const SendJoinResponseDto = z.object({
	event: z.record(z.string(), z.any()).describe('The processed join event'),
	state: z.array(
		z.record(z.string(), z.any())
	).describe('Current state events in the room'),
	auth_chain: z.array(
		z.record(z.string(), z.any())
	).describe('Authorization chain for the event'),
	members_omitted: z.boolean().describe('Whether member events were omitted'),
	origin: ServerNameDto,
});

export type SendJoinParams = z.infer<typeof SendJoinParamsDto>;
export type SendJoinEvent = z.infer<typeof SendJoinEventDto>;
export type SendJoinResponse = z.infer<typeof SendJoinResponseDto>;