import { Elysia } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { makeRequest } from "../../../makeRequest";
import { config } from "../../../config";
import { signJson } from "../../../signJson";

export const inviteEndpoint = new Elysia().put(
	"/invite/:roomId/:eventId",
	({ params, body }) => {
		setTimeout(async () => {
			const { event } = body as any;

			const response = await makeRequest({
				method: "GET",
				domain: event.origin,
				uri: `/_matrix/federation/v1/make_join/${params.roomId}/${event.state_key}?ver=10`,
			});

			const responseMake = await response.json();
			console.log("make_join ->", responseMake);

			// const joinBody = {
			//   type: 'm.room.member',
			//   origin: config.name,
			//   origin_server_ts: Date.now(),
			//   room_id: responseMake.event.room_id,
			//   state_key: responseMake.event.state_key,
			//   sender: responseMake.event.sender,
			//   depth: responseMake.event.depth + 1,
			//   content: {
			//     membership: 'join'
			//   }
			// };

			const joinBody = {
				...responseMake.event,
				origin: config.name,
				origin_server_ts: Date.now(),
				depth: responseMake.event.depth + 1,
			};

			console.log("joinBody ->", joinBody);

			const responseSend = await makeRequest({
				method: "PUT",
				domain: event.origin,
				uri: `/_matrix/federation/v1/send_join/${params.roomId}/${event.state_key}?omit_members=true`,
				options: {
					body: joinBody,
				},
			});

			const responseBody = await responseSend.json();

			console.log("send_join ->", responseBody);
		}, 1000);

		return config.signingKey.reduce(
			(json: any, signingKey) => signJson(json, signingKey, config.name),
			body,
		);
	},
);
