import { expect, test } from "bun:test";

import { generateKeyPairsFromString } from "../keys";
import { generateId } from "../authentication";
import { signEvent } from "../signEvent";
import { roomJoinRulesEvent } from "./m.room.join_rules";

const finalEventId = "$Uxo9MgF-4HQNEZdkkQDzgh9wlZ1yJbDXTMXCh6aZBi4";
const finalEvent = {
	auth_events: [
		"$T20EETjD2OuaC1OVyg8iIbJGTNeGBsMiWoAagBOVRNE",
		"$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4",
		"$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8",
	],
	prev_events: ["$T20EETjD2OuaC1OVyg8iIbJGTNeGBsMiWoAagBOVRNE"],
	type: "m.room.join_rules",
	room_id: "!uTqsSSWabZzthsSCNf:hs1",
	sender: "@admin:hs1",
	content: { join_rule: "invite" },
	depth: 4,
	state_key: "",
	origin: "hs1",
	origin_server_ts: 1733107418719,
	hashes: { sha256: "d3g1gHQsf/chWvoUMLe9iJlQQoVxEm6ajBW4Wdq9LUQ" },
	signatures: {
		hs1: {
			"ed25519:a_HDhg":
				"egXzghr88RZMZYG4/DUrIf92NiUiC59GhgmvB1zV5oSuDuCGXgYnVBmXOfQ54ElXx1AFc8ajwPmfupXoYkHaAg",
		},
	},
	unsigned: { age_ts: 1733107418719 },
};

test("roomJoinRulesEvent", async () => {
	const signature = await generateKeyPairsFromString(
		"ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw",
	);

	const event = roomJoinRulesEvent({
		roomId: "!uTqsSSWabZzthsSCNf:hs1",
		auth_events: [
			"$T20EETjD2OuaC1OVyg8iIbJGTNeGBsMiWoAagBOVRNE",
			"$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4",
			"$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8",
		],
		depth: 4,
		prev_events: ["$T20EETjD2OuaC1OVyg8iIbJGTNeGBsMiWoAagBOVRNE"],
		sender: "@admin:hs1",
		ts: 1733107418719,
	});

	const signed = await signEvent(event, signature, "hs1");

	expect(signed).toStrictEqual(finalEvent);
	expect(signed).toHaveProperty(
		"signatures.hs1.ed25519:a_HDhg",
		"egXzghr88RZMZYG4/DUrIf92NiUiC59GhgmvB1zV5oSuDuCGXgYnVBmXOfQ54ElXx1AFc8ajwPmfupXoYkHaAg",
	);

	const eventId = generateId(signed);

	expect(eventId).toBe(finalEventId);
});
