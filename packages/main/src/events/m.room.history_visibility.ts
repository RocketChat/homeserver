import { createEventBase } from "./eventBase";

export const roomHistoryVisibilityEvent = ({
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
	return createEventBase({
		roomId,
		sender,
		auth_events,
		prev_events,
		depth,
		type: "m.room.history_visibility",
		content: { history_visibility: "shared" },
		state_key: "",
		origin_server_ts: ts,
		unsigned: { age_ts: ts },
	});
};
