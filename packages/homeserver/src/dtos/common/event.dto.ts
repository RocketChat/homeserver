import { z } from 'zod';
import { DepthDto, RoomIdDto, TimestampDto, UsernameDto } from './validation.dto';

export const EventHashDto = z.object({
	sha256: z.string().describe('SHA256 hash of the event'),
});

export const EventSignatureDto = z.record(
	z.string(),
	z.record(z.string(), z.string())
).describe('Event signatures by server and key ID');

export const EventBaseDto = z.object({
	type: z.string().describe('Event type'),
	content: z.record(z.string(), z.any()).describe('Event content'),
	sender: UsernameDto,
	room_id: RoomIdDto,
	origin_server_ts: TimestampDto,
	depth: DepthDto.optional(),
	prev_events: z.array(
		z.string()
	).describe('Previous events in the room'),
	auth_events: z.array(
		z.string()
	).describe('Authorization events'),
	origin: z.string().describe('Origin server').optional(),
	hashes: EventHashDto.optional(),
	signatures: EventSignatureDto.optional(),
	unsigned: z.record(z.string(), z.any()).describe('Unsigned data').optional(),
});

export const MembershipEventContentDto = z.object({
	membership: z.union([
		z.literal('join'),
		z.literal('leave'),
		z.literal('invite'),
		z.literal('ban'),
		z.literal('knock')
	]).describe('Membership state'),
	displayname: z.union([z.string(), z.null()]).optional(),
	avatar_url: z.union([z.string(), z.null()]).optional(),
	join_authorised_via_users_server: z.union([z.string(), z.null()]).optional(),
	is_direct: z.union([z.boolean(), z.null()]).optional(),
	reason: z.string().describe('Reason for membership change').optional(),
});

export const RoomMemberEventDto = EventBaseDto.merge(
	z.object({
		type: z.literal('m.room.member').optional(),
		content: MembershipEventContentDto,
		state_key: UsernameDto,
	})
);