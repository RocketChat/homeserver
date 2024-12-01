import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { config } from "../../config";
import { signJson } from "../../signJson";
import { authorizationHeaders, computeHash } from "../../authentication";
import { makeUnsignedRequest } from "../../makeRequest";

export const fakeEndpoints = new Elysia({ prefix: "/fake" })
	.post("/sendMessage", async ({ body }) => {
		const {
			depth = 11,
			sender,
			roomId,
			msg,
			target,
		} = body as any;

		const event = {
			auth_events: [
				"$MzSHSOBqyi_-xMtw6D3rSmnw8dkoXjBTxL6n_yqoRZk", // create
				"$qn8E_3ObThb9DPzFzVvOBDqN-6lv9khD-crEb4gl9Jc", // invite
				"$aRNnIRDdukq3Z5KjUCSusr16QvALrzGvUgDbWYQ5NPk", // join
				"$_Aznw7egnflk5VP7-POwehWhPLpjjMj6DBaLGnG86oM" // power
			],
			prev_events: [
				"$wXyhtSgwd0e5r3VYViz_Lz4KWQNUVLes4LA7lHlTJhY"
			],
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
				await signJson(computeHash(event), config.signingKey[0], config.name)
			],
		};
		console.log('payload ->', payload);

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
	},
);
