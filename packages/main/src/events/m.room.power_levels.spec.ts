import { expect, test } from "bun:test";

import { generateKeyPairsFromString } from "../keys";
import { generateId } from "../authentication";
import { signEvent } from "../signEvent";
import { roomPowerLevelsEvent } from "./m.room.power_levels";

const finalEventId = "$T20EETjD2OuaC1OVyg8iIbJGTNeGBsMiWoAagBOVRNE";
const finalEvent = {
	auth_events: [
		"$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4",
		"$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8",
	],
	prev_events: ["$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8"],
	type: "m.room.power_levels",
	room_id: "!uTqsSSWabZzthsSCNf:hs1",
	sender: "@admin:hs1",
	content: {
		users: { "@admin:hs1": 100, "@asd6:rc1": 100 },
		users_default: 0,
		events: {
			"m.room.name": 50,
			"m.room.power_levels": 100,
			"m.room.history_visibility": 100,
			"m.room.canonical_alias": 50,
			"m.room.avatar": 50,
			"m.room.tombstone": 100,
			"m.room.server_acl": 100,
			"m.room.encryption": 100,
		},
		events_default: 0,
		state_default: 50,
		ban: 50,
		kick: 50,
		redact: 50,
		invite: 0,
		historical: 100,
	},
	depth: 3,
	state_key: "",
	origin: "hs1",
	origin_server_ts: 1733107418713,
	hashes: { sha256: "7Sv2UTnpNI9qnVO1oXaNoj1SEraxoWTm9uloqm3Oqho" },
	signatures: {
		hs1: {
			"ed25519:a_HDhg":
				"UBNpsQBCDX7t6cPHSj+g4bfAf/9Gb1TxYnme2MCXF4JgN7P3X0OUq0leFjrI5p/+sTR60/nuaZCX7OUYWTTLDA",
		},
	},
	unsigned: { age_ts: 1733107418713 },
};

test("roomPowerLevelsEvent", async () => {
	const signature = await generateKeyPairsFromString(
		"ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw",
	);

	const event = roomPowerLevelsEvent({
		roomId: "!uTqsSSWabZzthsSCNf:hs1",
		auth_events: [
			"$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4",
			"$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8",
		],
		depth: 3,
		prev_events: ["$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8"],
		sender: "@admin:hs1",
		member: "@asd6:rc1",
		ts: 1733107418713,
	});

	const signed = await signEvent(event, signature);

	expect(signed).toStrictEqual(finalEvent);
	expect(signed).toHaveProperty(
		"signatures.hs1.ed25519:a_HDhg",
		"UBNpsQBCDX7t6cPHSj+g4bfAf/9Gb1TxYnme2MCXF4JgN7P3X0OUq0leFjrI5p/+sTR60/nuaZCX7OUYWTTLDA",
	);

	const eventId = generateId(signed);

	expect(eventId).toBe(finalEventId);
});
