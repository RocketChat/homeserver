import { createEventBase } from "./eventBase";

export const roomGuestAccessEvent = ({
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
		type: "m.room.guest_access",
		content: { guest_access: "can_join" },
		// state_key: sender,
		origin_server_ts: ts,
		unsigned: { age_ts: ts },
	});
};
