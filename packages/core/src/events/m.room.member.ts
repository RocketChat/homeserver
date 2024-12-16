import { createEventBase, type EventBase } from "./eventBase";
import { createEventWithId } from "./utils/createSignedEvent";

type Membership = "join" | "invite";

declare module "./eventBase" {
	interface Events {
		"m.room.member": {
			unsigned: {
				age_ts: number;
			};
			content: {
				join_authorised_via_users_server?: string;
				membership: Membership;
			};
		};
	}
}

export const isRoomMemberEvent = (
	event: EventBase,
): event is RoomMemberEvent => {
	return event.type === "m.room.member";
};
export interface RoomMemberEvent extends EventBase {
	type: "m.room.member";
	content: {
		membership: Membership;
		join_authorised_via_users_server?: string;
	};
	state_key: string;
	unsigned: {
		// TODO: Check what this is
		age: number;
		age_ts: number;
		invite_room_state: (
			| {
					type: "m.room.join_rules";
					state_key: "";
					content: { join_rule: "invite" };
					sender: string;
			  }
			| {
					type: "m.room.create";
					state_key: "";
					content: { room_version: "10"; creator: string };
					sender: string;
			  }
			| {
					type: "m.room.member";
					state_key: string;
					content: { displayname: "admin"; membership: "join" };
					sender: string;
			  }
		)[];
	};
}

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
	auth_events: string[];
	prev_events: string[];
	depth: number;
	unsigned?: RoomMemberEvent["unsigned"];
	content?: Record<string, any>;
	origin?: string;
	ts?: number;
}): RoomMemberEvent => {
	return createEventBase("m.room.member", {
		roomId,
		sender,
		auth_events,
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
