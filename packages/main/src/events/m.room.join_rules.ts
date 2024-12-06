import { createEventBase, type EventBase } from "./eventBase";
import { createEventWithId } from "./utils/createSignedEvent";

declare module "./eventBase" {
	interface Events {
		"m.room.join_rules": RoomJoinRulesEvent;
	}
}

interface RoomJoinRulesEvent extends EventBase {
	content: {
		join_rule: "invite" | "knock" | "public";
	};
	unsigned?: {
		age_ts: number;
	};
}

export const roomJoinRulesEvent = ({
	roomId,
	sender,
	auth_events,
	prev_events,
	depth,
	ts = Date.now(),
}: {
	roomId: string;
	sender: string;
	auth_events: string[];
	prev_events: string[];
	depth: number;
	ts?: number;
}) => {
	return createEventBase("m.room.join_rules", {
		roomId,
		sender,
		auth_events,
		prev_events,
		depth,
		content: { join_rule: "invite" },
		state_key: "",
		ts,
		origin_server_ts: ts,
		unsigned: { age_ts: ts },
	});
};

export const createRoomJoinRulesEvent = createEventWithId(roomJoinRulesEvent);
