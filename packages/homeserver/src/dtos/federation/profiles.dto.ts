import { type Static, t } from 'elysia';
import {
	RoomIdDto,
	ServerNameDto,
	TimestampDto,
	UsernameDto,
} from '../common/validation.dto';

export const QueryProfileQueryDto = t.Object({
	user_id: UsernameDto,
	field: t.Optional(
		t.Union([t.Literal('displayname'), t.Literal('avatar_url')]),
	),
});

export const QueryProfileResponseDto = t.Object({
	displayname: t.Optional(t.String({ description: 'User display name' })),
	avatar_url: t.String({ description: 'User avatar URL (MXC URL)' }),
});

export const QueryKeysBodyDto = t.Object({
	device_keys: t.Record(t.String(), t.String(), {
		description: 'Device keys to query',
	}),
});

export const QueryKeysResponseDto = t.Object({
	device_keys: t.Record(t.String(), t.Any(), {
		description: 'Device keys for the requested users',
	}),
});

export const GetDevicesParamsDto = t.Object({
	userId: UsernameDto,
});

export const GetDevicesResponseDto = t.Object({
	user_id: UsernameDto,
	stream_id: t.Number({ description: 'Device list stream ID' }),
	devices: t.Array(
		t.Object({
			device_id: t.String({ description: 'Device ID' }),
			display_name: t.Optional(
				t.String({ description: 'Device display name' }),
			),
			last_seen_ip: t.Optional(
				t.String({ description: 'Last seen IP address' }),
			),
			last_seen_ts: t.Optional(TimestampDto),
		}),
		{ description: 'List of devices for the user' },
	),
});

export const MakeJoinParamsDto = t.Object({
	roomId: RoomIdDto,
	userId: UsernameDto,
});

export const RoomVersionDto = t.Union([
	t.Literal('1'),
	t.Literal('2'),
	t.Literal('3'),
	t.Literal('4'),
	t.Literal('5'),
	t.Literal('6'),
	t.Literal('7'),
	t.Literal('8'),
	t.Literal('9'),
	t.Literal('10'),
	t.Literal('11'),
]);

export const MakeJoinQueryDto = t.Object({
	ver: t.Optional(
		t.Array(RoomVersionDto, {
			description: 'Supported room versions',
		}),
	),
});

const MembershipDto = t.Union([
	t.Literal('join'),
	t.Literal('leave'),
	t.Literal('invite'),
	t.Literal('ban'),
	t.Literal('knock'),
]);

export const MakeJoinResponseDto = t.Object({
	room_version: t.String({ description: 'Room version' }),
	event: t.Object({
		content: t.Object({
			membership: MembershipDto,
			join_authorised_via_users_server: t.Optional(t.String()),
		}),
		room_id: RoomIdDto,
		sender: UsernameDto,
		state_key: UsernameDto,
		type: t.Literal('m.room.member'),
		origin_server_ts: TimestampDto,
		depth: t.Optional(
			t.Number({ description: 'Depth of the event in the DAG' }),
		),
		prev_events: t.Optional(
			t.Array(t.String(), { description: 'Previous events in the room' }),
		),
		auth_events: t.Optional(
			t.Array(t.String(), { description: 'Authorization events' }),
		),
		hashes: t.Optional(
			t.Object({
				sha256: t.String({ description: 'SHA256 hash of the event' }),
			}),
		),
		signatures: t.Optional(
			t.Record(t.String(), t.Record(t.String(), t.String()), {
				description: 'Event signatures by server and key ID',
			}),
		),
		unsigned: t.Optional(
			t.Record(t.String(), t.Any(), { description: 'Unsigned data' }),
		),
	}),
});

export const GetMissingEventsParamsDto = t.Object({
	roomId: RoomIdDto,
});

export const GetMissingEventsBodyDto = t.Object({
	earliest_events: t.Array(t.String(), { description: 'Earliest events' }),
	latest_events: t.Array(t.String(), { description: 'Latest events' }),
	limit: t.Number({
		minimum: 1,
		maximum: 100,
		default: 10,
		description: 'Maximum number of events to return',
	}),
	min_depth: t.Number({
		minimum: 1,
		default: 1,
		description: 'Minimum depth of the events to return',
	}),
});

export const GetMissingEventsResponseDto = t.Object({
	events: t.Array(t.Record(t.String(), t.Any()), {
		description: 'Missing events',
	}),
});

export const EventAuthParamsDto = t.Object({
	roomId: RoomIdDto,
	eventId: t.String({ description: 'Event ID' }),
});

export const EventAuthResponseDto = t.Object({
	auth_chain: t.Array(t.Record(t.String(), t.Any()), {
		description: 'Authorization chain for the event',
	}),
});

export type QueryKeysBody = Static<typeof QueryKeysBodyDto>;
export type QueryKeysResponse = Static<typeof QueryKeysResponseDto>;
export type GetDevicesParams = Static<typeof GetDevicesParamsDto>;
export type GetDevicesResponse = Static<typeof GetDevicesResponseDto>;
export type QueryProfileResponse = Static<typeof QueryProfileResponseDto>;
export type EventAuthResponse = Static<typeof EventAuthResponseDto>;
export type EventAuthParams = Static<typeof EventAuthParamsDto>;
export type GetMissingEventsResponse = Static<
	typeof GetMissingEventsResponseDto
>;
export type GetMissingEventsBody = Static<typeof GetMissingEventsBodyDto>;
export type GetMissingEventsParams = Static<typeof GetMissingEventsParamsDto>;
export type MakeJoinResponse = Static<typeof MakeJoinResponseDto>;
export type MakeJoinQuery = Static<typeof MakeJoinQueryDto>;
export type MakeJoinParams = Static<typeof MakeJoinParamsDto>;
export type QueryProfileQuery = Static<typeof QueryProfileQueryDto>;
