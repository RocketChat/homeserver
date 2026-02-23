import type { EventID } from '@rocket.chat/federation-room';

import { createEventBase } from './eventBase';
import type { Membership, RoomMemberEvent } from './isRoomMemberEvent';
import { createEventWithId } from './utils/createSignedEvent';

declare module './eventBase' {
	interface Events {
		'm.room.member': {
			unsigned: {
				age_ts: number;
			};
			content: {
				join_authorised_via_users_server?: string;
				membership: Membership;
				reason?: string;
			};
		};
	}
}

export type AuthEvents = {
	'm.room.create': EventID;
	'm.room.power_levels'?: EventID;
	'm.room.join_rules'?: EventID;
	'm.room.history_visibility'?: EventID;
} & {
	[K in `m.room.member:${string}`]?: EventID;
};

const isTruthy = <T>(value: T | null | undefined | false | 0 | ''): value is T => {
	return Boolean(value);
};

export const roomMemberEvent = ({
	membership,
	roomId,
	sender,
	state_key,
	auth_events,
	prev_events,
	depth,
	unsigned,
	content,
	origin,
	ts = Date.now(),
}: {
	membership: Membership;
	roomId: string;
	sender: string;
	state_key: string;
	auth_events: AuthEvents;
	prev_events: EventID[];
	depth: number;
	unsigned?: RoomMemberEvent['unsigned'];
	content?: Record<string, any>;
	origin?: string;
	ts?: number;
}): RoomMemberEvent => {
	return createEventBase('m.room.member', {
		roomId,
		sender,
		auth_events: [
			auth_events['m.room.create'],
			auth_events['m.room.power_levels'],
			auth_events['m.room.join_rules'],
			auth_events['m.room.history_visibility'],
			auth_events[`m.room.member:${state_key}`],
		].filter(isTruthy),
		prev_events,
		depth,
		content: {
			membership,
			...content,
		},
		state_key,
		origin_server_ts: ts,
		ts,
		origin,
		unsigned: { age_ts: ts, ...unsigned },
	});
};

export const createRoomMemberEvent = createEventWithId(roomMemberEvent);
