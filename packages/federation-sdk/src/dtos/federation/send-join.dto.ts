import { type Static, t } from 'elysia';
import {
	DepthDto,
	EventIdDto,
	RoomIdDto,
	ServerNameDto,
	TimestampDto,
	UsernameDto,
} from '../common/validation.dto';

export const SendJoinParamsDto = t.Object({
	roomId: RoomIdDto,
	stateKey: EventIdDto,
});

export const SendJoinEventDto = t.Object({
	type: t.Literal('m.room.member'),
	sender: UsernameDto,
	room_id: RoomIdDto,
	origin_server_ts: TimestampDto,
	depth: DepthDto,
	prev_events: t.Array(t.String()),
	auth_events: t.Array(t.String()),
	origin: t.String(),
	hashes: t.Optional(
		t.Object({
			sha256: t.String(),
		}),
	),
	signatures: t.Optional(
		t.Record(t.String(), t.Record(t.String(), t.String())),
	),
	unsigned: t.Optional(
		t.Object({
			age: t.Number(),
			age_ts: t.Number(),
			invite_room_state: t.Optional(t.Array(t.Record(t.String(), t.Any()))),
		}),
	),
	content: t.Object({
		membership: t.Literal('join'),
		join_rule: t.Union([
			t.Literal('invite'),
			t.Literal('knock'),
			t.Literal('public'),
			t.Literal('restricted'),
			t.Literal('knock_restricted'),
		]),
		join_authorised_via_users_server: t.Optional(t.String()),
		third_party_invite: t.Optional(
			t.Object({
				signed: t.Object({
					mxid: t.String(),
					token: t.String(),
					signatures: t.Record(t.String(), t.Record(t.String(), t.String())),
				}),
			}),
		),
		reason: t.Optional(t.String()),
		avatar_url: t.Optional(t.Union([t.String(), t.Null()])),
		displayname: t.Optional(t.Union([t.String(), t.Null()])),
	}),
	state_key: UsernameDto,
});

export const SendJoinResponseDto = t.Object({
	event: t.Record(t.String(), t.Any(), {
		description: 'The processed join event',
	}),
	state: t.Array(t.Record(t.String(), t.Any()), {
		description: 'Current state events in the room',
	}),
	auth_chain: t.Array(t.Record(t.String(), t.Any()), {
		description: 'Authorization chain for the event',
	}),
	members_omitted: t.Boolean({
		description: 'Whether member events were omitted',
	}),
	origin: ServerNameDto,
});

export type SendJoinParams = Static<typeof SendJoinParamsDto>;
export type SendJoinEvent = Static<typeof SendJoinEventDto>;
export type SendJoinResponse = Static<typeof SendJoinResponseDto>;
