import { createEventBase } from "./eventBase";

export const roomCreateEvent = ({
	roomId,
	sender,
	ts = Date.now(),
}: {
	roomId: string;
	sender: string;
	ts?: number;
}) => {
	return createEventBase<
		{ room_version: string; creator: string },
		{ age_ts: number }
	>({
		roomId,
		sender,
		depth: 1,
		type: "m.room.create",
		content: {
			room_version: "10",
			creator: sender,
		},
		state_key: "",
		origin_server_ts: ts,
		unsigned: { age_ts: ts },
	});
};
