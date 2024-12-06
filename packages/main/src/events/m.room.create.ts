import { generateId } from "../authentication";
import type { SigningKey } from "../keys";
import { signEvent } from "../signEvent";
import { createEventBase, type EventBase } from "./eventBase";

type RoomCreateEvent = {
	roomId: string;
	sender: string;
	ts?: number;
};

export const roomCreateEvent = ({
	roomId,
	sender,
	ts = Date.now(),
}: RoomCreateEvent) => {
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
