import { createEventBase } from "./eventBase";

export const roomMemberEvent = ({
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
	const displayname = sender.split(":").shift()?.replaceAll("@", "");
	if (!displayname) {
		throw new Error("Invalid sender");
	}

	return createEventBase<{ displayname: string; membership: string }>({
		roomId,
		sender,
		auth_events,
		prev_events,
		depth,
		type: "m.room.member",
		content: {
			displayname,
			membership: "join",
		},
		state_key: sender,
		origin_server_ts: ts,
		unsigned: { age_ts: ts },
	});
};
