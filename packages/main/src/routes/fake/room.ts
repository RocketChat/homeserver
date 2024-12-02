import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { config } from "../../config";
import { signJson } from "../../signJson";
import { computeHash, generateId } from "../../authentication";
import { makeUnsignedRequest } from "../../makeRequest";
import { pruneEventDict } from "../../pruneEventDict";

export const fakeEndpoints = new Elysia({ prefix: "/fake" }).post(
	"/sendMessage",
	async ({ body, error }) => {
		const { depth = 13, sender, roomId, msg, target } = body as any;

		const { events } = await import("../../mongodb");

		const create = await events.findOne({
			room_id: roomId,
			type: "m.room.create",
		});

		// const powerLevels = await events.findOne({
		// 	room_id: roomId,
		// 	type: "m.room.power_levels",
		// });

		const member = await events.findOne({
			room_id: roomId,
			type: "m.room.member",
			"content.membership": "join",
		});

		const [last] = await events
			.find(
				{
					room_id: roomId,
				},
				{ sort: { origin_server_ts: -1 }, limit: 1 },
			)
			.toArray();

		if (!create || !member || !last) {
			return error(400, "Invalid room_id");
		}

		create.event_id = generateId(create);
		member.event_id = generateId(member);
		last.event_id = generateId(last);
		// powerLevels.event_id = generateId(powerLevels);

		const event = {
			auth_events: [
				create.event_id,
				// powerLevels.event_id,
				member.event_id,
			],
			prev_events: [last.event_id],
			type: "m.room.message",
			depth,
			content: {
				body: msg,
			},
			origin: config.name,
			origin_server_ts: Date.now(),
			room_id: roomId,
			sender,
		};

		const payload = {
			origin: config.name,
			origin_server_ts: Date.now(),
			pdus: [
				{
					...(await signJson(
						pruneEventDict(computeHash(event)),
						config.signingKey[0],
						config.name,
					)),
					...event,
				},
			],
		};
		console.log("payload ->", payload);

		const response = await makeUnsignedRequest({
			method: "PUT",
			domain: target,
			uri: `/_matrix/federation/v1/send/${Date.now()}`,
			options: {
				body: payload,
			},
		});

		const responseMake = await response.json();
		console.log("response ->", responseMake);

		return responseMake;
	},
);
