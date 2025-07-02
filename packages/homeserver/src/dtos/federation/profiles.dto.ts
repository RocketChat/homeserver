import { z } from 'zod';
import { RoomIdDto, ServerNameDto, TimestampDto, UsernameDto } from '../common/validation.dto';

export const QueryProfileQueryDto = z.object({
	user_id: UsernameDto,
});

export const QueryProfileResponseDto = z.object({
	displayname: z.union([z.string(), z.null()]).optional(),
	avatar_url: z.union([z.string(), z.null()]).optional(),
});


export const QueryKeysBodyDto = z.object({
	device_keys: z.record(z.string(), z.string())
		.describe('Device keys to query'),
});

export const QueryKeysResponseDto = z.object({
	device_keys: z.record(z.string(), z.any())
		.describe('Device keys for the requested users'),
});

export const GetDevicesParamsDto = z.object({
	userId: UsernameDto,
});

export const GetDevicesResponseDto = z.object({
	user_id: UsernameDto,
	stream_id: z.number().describe('Device list stream ID'),
	devices: z.array(
		z.object({
			device_id: z.string().describe('Device ID'),
			display_name: z.string().describe('Device display name').optional(),
			last_seen_ip: z.string().describe('Last seen IP address').optional(),
			last_seen_ts: TimestampDto.optional(),
		})
	).describe('List of devices for the user'),
});

export const MakeJoinParamsDto = z.object({
	roomId: RoomIdDto,
	userId: UsernameDto,
});

export const MakeJoinQueryDto = z.object({
	ver: z.array(z.string()).describe('Supported room versions').optional(),
});

export const MakeJoinResponseDto = z.object({
	room_version: z.string().describe('Room version'),
	event: z.object({
		content: z.object({
			membership: z.literal('join'),
			join_authorised_via_users_server: z.string().optional(),
		}),
		room_id: RoomIdDto,
		sender: UsernameDto,
		state_key: UsernameDto,
		type: z.literal('m.room.member'),
		origin_server_ts: TimestampDto,
		origin: ServerNameDto,
		depth: z.number().describe('Depth of the event in the DAG').optional(),
		prev_events: z.array(z.string()).describe('Previous events in the room').optional(),
		auth_events: z.array(z.string()).describe('Authorization events').optional(),
		hashes: z.object({
			sha256: z.string().describe('SHA256 hash of the event'),
		}).optional(),
		signatures: z.record(
			z.string(),
			z.record(z.string(), z.string())
		).describe('Event signatures by server and key ID').optional(),
		unsigned: z.record(z.string(), z.any()).describe('Unsigned data').optional(),
	}),
});

export const GetMissingEventsParamsDto = z.object({
	roomId: RoomIdDto,
});

export const GetMissingEventsBodyDto = z.object({
	earliest_events: z.array(z.string()).describe('Earliest events'),
	latest_events: z.array(z.string()).describe('Latest events'),
	limit: z.number().min(1).max(100).describe('Maximum number of events to return'),
});

export const GetMissingEventsResponseDto = z.object({
	events: z.array(
		z.record(z.string(), z.any())
	).describe('Missing events'),
});

export const EventAuthParamsDto = z.object({
	roomId: RoomIdDto,
	eventId: z.string().describe('Event ID'),
});

export const EventAuthResponseDto = z.object({
	auth_chain: z.array(
		z.record(z.string(), z.any())
	).describe('Authorization chain for the event'),
});

export type QueryKeysBody = z.infer<typeof QueryKeysBodyDto>;
export type QueryKeysResponse = z.infer<typeof QueryKeysResponseDto>;
export type GetDevicesParams = z.infer<typeof GetDevicesParamsDto>;
export type GetDevicesResponse = z.infer<typeof GetDevicesResponseDto>;
export type QueryProfileResponse = z.infer<typeof QueryProfileResponseDto>;
export type EventAuthResponse = z.infer<typeof EventAuthResponseDto>;
export type EventAuthParams = z.infer<typeof EventAuthParamsDto>;
export type GetMissingEventsResponse = z.infer<typeof GetMissingEventsResponseDto>;
export type GetMissingEventsBody = z.infer<typeof GetMissingEventsBodyDto>;
export type GetMissingEventsParams = z.infer<typeof GetMissingEventsParamsDto>;
export type MakeJoinResponse = z.infer<typeof MakeJoinResponseDto>;
export type MakeJoinQuery = z.infer<typeof MakeJoinQueryDto>;
export type MakeJoinParams = z.infer<typeof MakeJoinParamsDto>;
export type QueryProfileQuery = z.infer<typeof QueryProfileQueryDto>;
