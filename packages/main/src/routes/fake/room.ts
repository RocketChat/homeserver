import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { config } from "../../config";
import { signJson } from "../../signJson";
import { authorizationHeaders, computeHash } from "../../authentication";
import { makeUnsignedRequest } from "../../makeRequest";
import { pruneEventDict } from "../../pruneEventDict";

export const fakeEndpoints = new Elysia({ prefix: "/fake" }).post(
	"/sendMessage",
	async ({ body }) => {
		const { depth = 13, sender, roomId, msg, target } = body as any;

		const event = {
			auth_events: [
				"$2gJHmpNm-I1k4ZBjgWRMssnquEsxqbuvTjdrIG6kMQM", // create
				"$RTPGcee2yI2NPRxt4RxA_4lWJ2wpbddkRw5ujkA5S3A", // power_levels
				"$jmfyOatzZynPKLl6e8ekkkXZq7IM8_zACjOfBcdDNXM", // member
			],
			prev_events: ["$v9LrPeYOP3T1NKtk0PO-9lYypnFrxK-wlvJSuOs5pfE"],
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
