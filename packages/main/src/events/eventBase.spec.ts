import { expect, test } from "bun:test";

import { createEventBase } from "./eventBase";

test("eventBase - invalid sender (without ':' )", async () => {
	expect(() =>
		createEventBase({
			roomId: "",
			sender: "invalid",
			depth: 1,
			type: "m.room.member",
			state_key: "sender",
			origin_server_ts: 12,
			unsigned: { age_ts: 12 },
		}),
	).toThrowError("Invalid sender");
});

test("eventBase - invalid sender (without '@' )", async () => {
	expect(() =>
		createEventBase({
			roomId: "",
			sender: "invalid:invalid",
			depth: 1,
			type: "m.room.member",
			state_key: "sender",
			origin_server_ts: 12,
			unsigned: { age_ts: 12 },
		}),
	).toThrowError("Invalid sender");
});

test("eventBase - invalid roomId (without '!' )", async () => {
	expect(() =>
		createEventBase({
			roomId: "invalid",
			sender: "@valid:valid",
			depth: 1,
			type: "m.room.member",
			state_key: "sender",
			origin_server_ts: 12,
			unsigned: { age_ts: 12 },
		}),
	).toThrowError("Invalid room Id");
});

test("eventBase - invalid roomId (without '!' )", async () => {
	expect(() =>
		createEventBase({
			roomId: "invalid:invalid",
			sender: "@valid:valid",
			depth: 1,
			type: "m.room.member",
			state_key: "sender",
			origin_server_ts: 12,
			unsigned: { age_ts: 12 },
		}),
	).toThrowError("Invalid room Id");
});
