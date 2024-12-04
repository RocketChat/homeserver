import { createEventBase } from "./eventBase";

type Membership = "join" | "invite";

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
	unsigned?: Record<string, any>;
	content?: Record<string, any>;
	origin?: string;
	ts?: number;
}) => {
	return createEventBase<{ membership: string }, Record<string, unknown>>({
		roomId,
		sender,
		auth_events,
		prev_events,
		depth,
		type: "m.room.member",
		content: {
			membership,
			...content,
		},
		state_key,
		origin_server_ts: ts,
		ts,
		origin,
		unsigned: {
			...unsigned,
		},
	});
};
