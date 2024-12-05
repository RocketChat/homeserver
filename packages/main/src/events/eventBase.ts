export type EventBase<
	C extends Record<string, unknown> = Record<string, unknown>,
	U extends Record<string, unknown> = Record<string, unknown>,
> = {
	auth_events: string[];
	prev_events: string[];
	type:
		| "m.room.member"
		| "m.room.create"
		| "m.room.join_rules"
		| "m.room.power_levels"
		| "m.room.aliases"
		| "m.room.history_visibility"
		| "m.room.redaction"
		| string;
	room_id: string;
	sender: string;
	content: C;
	depth: number;
	state_key?: string;
	origin: string;
	origin_server_ts: number;
	unsigned: U;
};

export const createEventBase = <
	TContent extends EventBase["content"],
	TUnsigned extends EventBase["unsigned"],
>({
	roomId,
	sender,
	auth_events = [],
	prev_events = [],
	depth,
	type,
	content,
	state_key,
	origin_server_ts,
	unsigned,
	origin,
	ts = Date.now(),
}: {
	roomId: string;
	sender: string;
	auth_events?: string[];
	prev_events?: string[];
	depth: number;
	type: string;
	content?: TContent;
	state_key?: string;
	origin_server_ts: number;
	unsigned?: TUnsigned;
	origin?: string;
	ts?: number;
}): EventBase => {
	if (!sender.includes(":") || !sender.includes("@")) {
		throw new Error("Invalid sender");
	}
	if (!roomId.includes(":") || !roomId.includes("!")) {
		throw new Error("Invalid room Id");
	}
	return {
		auth_events,
		prev_events,
		type,
		room_id: roomId,
		sender,
		content: {
			...content,
		},
		depth,
		state_key,
		origin: origin || (sender.split(":").pop() as string),
		origin_server_ts,
		unsigned: { age_ts: ts, ...unsigned },
	};
};
