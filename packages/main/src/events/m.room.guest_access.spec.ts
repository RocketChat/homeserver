import { expect, test } from "bun:test";

import { roomCreateEvent } from "./m.room.create";
import { generateKeyPairs } from "../keys";
import { generateId } from "../authentication";
import { signEvent } from "../signEvent";

const finalEventId = "$gdAY3-3DdjuG-uyFkDn8q5wPS4fbymH__fch9BQmOas";
const finalEvent = {
	auth_events: [
		"$T20EETjD2OuaC1OVyg8iIbJGTNeGBsMiWoAagBOVRNE",
		"$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4",
		"$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8",
	],
	prev_events: ["$a4hYydlvVc738DgFJA4hDHaIl_umBkHSV_efweAO5PE"],
	type: "m.room.guest_access",
	room_id: "!uTqsSSWabZzthsSCNf:hs1",
	sender: "@admin:hs1",
	content: { guest_access: "can_join" },
	depth: 6,
	state_key: "",
	origin: "hs1",
	origin_server_ts: 1733107418721,
	hashes: { sha256: "ArUZZ33x+j5oMNWhWvHDXBH7qrMRMbsqig5XDM5jOac" },
	signatures: {
		hs1: {
			"ed25519:a_HDhg":
				"PLaE7un6a+pzrsU/0kiB/tvneZp5/dEda4+uE7UK411hNaM4W4ZUo52ua6AGO9q5gLBjSmnR90/tPf714HiTBw",
		},
	},
	unsigned: { age_ts: 1733107418721 },
};

test.todo("roomGuestAccessEvent", async () => {
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
