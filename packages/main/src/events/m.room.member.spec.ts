import { expect, test } from "bun:test";

import { roomCreateEvent } from "./m.room.create";
import { generateKeyPairs } from "../keys";
import { generateId } from "../authentication";
import { signEvent } from "../signEvent";

const finalEventId = "$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8";
const finalEvent = {
	auth_events: ["$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4"],
	prev_events: ["$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4"],
	type: "m.room.member",
	room_id: "!uTqsSSWabZzthsSCNf:hs1",
	sender: "@admin:hs1",
	content: { displayname: "admin", membership: "join" },
	depth: 2,
	state_key: "@admin:hs1",
	origin: "hs1",
	origin_server_ts: 1733107418672,
	hashes: { sha256: "7qLYbHf6z6nLGkN0DABO89wgDjaeZwq0ma7GsPbhZ8I" },
	signatures: {
		hs1: {
			"ed25519:a_HDhg":
				"y/qV5T9PeXvqgwRafZDSygtk4XRMstdt04qusZWJSu77Juxzzz4Ijyk+JsJ5NNV0/WWYMT9IhmVb7/EEBH4vDQ",
		},
	},
	unsigned: { age_ts: 1733107418672 },
};

test.todo("roomMemberEvent", async () => {
	// const [signature] = await generateKeyPairs(
	// 	Uint8Array.from(atob("WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw"), (c) =>
	// 		c.charCodeAt(0),
	// 	),
	// );
	// const event = roomCreateEvent({
	// 	roomId: "!uTqsSSWabZzthsSCNf:hs1",
	// 	sender: "@admin:hs1",
	// 	ts: 1733107418648,
	// });
	// const signed = await signEvent(event, signature, "a_HDhg");
	// expect(signed).toStrictEqual(finalEvent);
	// expect(signed).toHaveProperty("signatures");
	// expect(signed.signatures).toBeObject();
	// expect(signed.signatures).toHaveProperty("hs1");
	// expect(signed.signatures.hs1).toBeObject();
	// expect(signed.signatures.hs1).toHaveProperty("ed25519:a_HDhg");
	// expect(signed.signatures.hs1["ed25519:a_HDhg"]).toBeString();
	// expect(signed.signatures.hs1["ed25519:a_HDhg"]).toBe(
	// 	"rmnvsWlTL+JP8Sk9767UR0svF4IrzC9zhUPbT+y4u31r/qtIaF9OtT1FP8tD/yFGD92qoTcRb4Oo8DRbLRXcAg",
	// );
	// const eventId = generateId(signed);
	// expect(eventId).toBe(finalEventId);
});
