import { expect, test } from "bun:test";

import { generateId } from "../authentication";
import { generateKeyPairsFromString } from "../keys";
import { signEvent } from "../signEvent";
import { roomMemberEvent } from "./m.room.member";

const finalEventId = "$GAcbc4lUMhfCAWFZxoVZ6Pmzhcea1zKoY92ji4LjMqk";
const finalEvent = {
	auth_events: [
		"$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4",
		"$T20EETjD2OuaC1OVyg8iIbJGTNeGBsMiWoAagBOVRNE",
		"$Uxo9MgF-4HQNEZdkkQDzgh9wlZ1yJbDXTMXCh6aZBi4",
		"$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8",
	],
	prev_events: ["$gdAY3-3DdjuG-uyFkDn8q5wPS4fbymH__fch9BQmOas"],
	type: "m.room.member",
	room_id: "!uTqsSSWabZzthsSCNf:hs1",
	sender: "@admin:hs1",
	content: {
		is_direct: true,
		displayname: "@asd6:rc1",
		avatar_url: "mxc://matrix.org/MyC00lAvatar",
		membership: "invite",
	},
	depth: 7,
	state_key: "@asd6:rc1",
	origin: "hs1",
	origin_server_ts: 1733107418773,
	hashes: { sha256: "669gCNgB3VnQWmH+vIg/9CwyC5wOQmGuA8+PiIhiT50" },
	signatures: {
		hs1: {
			"ed25519:a_HDhg":
				"ZGtHq5OuryBhQZOhZRAxGSej9BKU+5nDhzhQ9GfuUoAvP3InUch+Jznca3sblfy0LeZcdGJ866QpbH1eAGYsBQ",
		},
	},
	unsigned: {
		age: 4,
		age_ts: 1733107418773,
		invite_room_state: [
			{
				type: "m.room.join_rules",
				state_key: "",
				content: { join_rule: "invite" },
				sender: "@admin:hs1",
			},
			{
				type: "m.room.create",
				state_key: "",
				content: { room_version: "10", creator: "@admin:hs1" },
				sender: "@admin:hs1",
			},
			{
				type: "m.room.member",
				state_key: "@admin:hs1",
				content: { displayname: "admin", membership: "join" },
				sender: "@admin:hs1",
			},
		],
	},
};

test("roomMemberInviteEvent", async () => {
	const signature = await generateKeyPairsFromString(
		"ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw",
	);

	const memberEvent = roomMemberEvent({
		membership: "invite",
		roomId: "!uTqsSSWabZzthsSCNf:hs1",
		sender: "@admin:hs1",
		state_key: "@asd6:rc1",
		ts: 1733107418773,
		depth: 7,
		auth_events: [
			"$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4",
			"$T20EETjD2OuaC1OVyg8iIbJGTNeGBsMiWoAagBOVRNE",
			"$Uxo9MgF-4HQNEZdkkQDzgh9wlZ1yJbDXTMXCh6aZBi4",
			"$tZRt2bwceX4sG913Ee67tJiwe-gk859kY2mCeYSncw8",
		],
		prev_events: ["$gdAY3-3DdjuG-uyFkDn8q5wPS4fbymH__fch9BQmOas"],
		content: {
			is_direct: true,
			displayname: "@asd6:rc1",
			avatar_url: "mxc://matrix.org/MyC00lAvatar",
			membership: "invite",
		},
		unsigned: {
			// TODO: Check what this is
			age: 4,
			age_ts: 1733107418773,
			invite_room_state: [
				{
					type: "m.room.join_rules",
					state_key: "",
					content: { join_rule: "invite" },
					sender: "@admin:hs1",
				},
				{
					type: "m.room.create",
					state_key: "",
					content: { room_version: "10", creator: "@admin:hs1" },
					sender: "@admin:hs1",
				},
				{
					type: "m.room.member",
					state_key: "@admin:hs1",
					content: { displayname: "admin", membership: "join" },
					sender: "@admin:hs1",
				},
			],
		},
	} as const);
	const signed = await signEvent(memberEvent, signature, "hs1");
	// @ts-ignore
	expect(signed).toStrictEqual(finalEvent);
	expect(signed).toHaveProperty(
		"signatures.hs1.ed25519:a_HDhg",
		"ZGtHq5OuryBhQZOhZRAxGSej9BKU+5nDhzhQ9GfuUoAvP3InUch+Jznca3sblfy0LeZcdGJ866QpbH1eAGYsBQ",
	);

	const memberEventId = generateId(signed);

	expect(memberEventId).toBe(finalEventId);
});
