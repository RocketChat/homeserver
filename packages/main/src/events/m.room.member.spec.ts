import { expect, test } from "bun:test";

import { generateId } from "../authentication";
import { generateKeyPairsFromString } from "../keys";
import { signEvent } from "../signEvent";
import { roomCreateEvent } from "./m.room.create";
import { roomMemberEvent } from "./m.room.member";

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

test("roomMemberEvent", async () => {
	const signature = await generateKeyPairsFromString(
		"ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw",
	);

	const createEvent = roomCreateEvent({
		roomId: "!uTqsSSWabZzthsSCNf:hs1",
		sender: "@admin:hs1",
		ts: 1733107418648,
	});
	const signedCreateEvent = await signEvent(createEvent, signature);

	const createEventId = generateId(signedCreateEvent);
	const memberEvent = roomMemberEvent({
		roomId: "!uTqsSSWabZzthsSCNf:hs1",
		sender: "@admin:hs1",
		ts: 1733107418672,
		depth: 2,
		auth_events: [createEventId],
		prev_events: [createEventId],
	});
	const signed = await signEvent(memberEvent, signature, "hs1");

	expect(signed).toStrictEqual(finalEvent);
	expect(signed).toHaveProperty(
		"signatures.hs1.ed25519:a_HDhg",
		"y/qV5T9PeXvqgwRafZDSygtk4XRMstdt04qusZWJSu77Juxzzz4Ijyk+JsJ5NNV0/WWYMT9IhmVb7/EEBH4vDQ",
	);

	const memberEventId = generateId(signed);

	expect(memberEventId).toBe(finalEventId);
});

test("roomMemberEvent - should throw an error when displayname is invalid", async () => {
	expect(() =>
		roomMemberEvent({
			roomId: "!uTqsSSWabZzthsSCNf:hs1",
			sender: "",
			ts: 1733107418672,
			depth: 2,
			auth_events: [],
			prev_events: [],
		}),
	).toThrowError("Invalid sender");
});
