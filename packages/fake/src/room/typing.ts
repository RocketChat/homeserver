import { makeUnsignedRequest } from "@hs/homeserver/src/makeRequest";
import { isConfigContext } from "@hs/homeserver/src/plugins/isConfigContext";
import { type Elysia, t } from "elysia";

import { createTypingEvent } from '@hs/core/src/events/edu/m.typing';

export const typingEndpoint = async (app: Elysia) =>
	app.post('/typing', async ({ body, error, ...context }) => {
		if (!isConfigContext(context)) {
			throw new Error("No config context");
		}
		const {
			config,
		} = context;

		console.log('body.typing ->', body.typing);

		const payload = {
			origin: config.name,
			origin_server_ts: Date.now(),
			edus: [
				createTypingEvent({
					roomId: body.roomId,
					sender: body.sender,
					typing: body.typing,
				}),
			],
			pdus: [],
		};
		console.log("payload ->", payload);

		const responses = await Promise.all(body.targets.map((target) => makeUnsignedRequest({
				method: "PUT",
				domain: target,
				uri: `/_matrix/federation/v1/send/${Date.now()}`,
				options: { body: payload },
				signingKey: config.signingKey[0],
				signingName: config.name,
			} as any)));

		// const responseMake = await makeUnsignedRequest({
		// 	method: "PUT",
		// 	domain: body.target,
		// 	uri: `/_matrix/federation/v1/send/${Date.now()}`,
		// 	body: payload,
		// 	signingKey: config.signingKey[0],
		// 	signingName: config.name,
		// } as any);

		console.log("responses ->", responses);

		return { responses };
	}, {
		body: t.Object(
			{
				sender: t.String(),
				roomId: t.String(),
				typing: t.Boolean({ default: true }),
				targets: t.Array(t.String()),
			},
			{
				examples: [
					{
						sender: "@a1:rc1",
						roomId: "!uTqsSSWabZzthsSCNf:hs1",
						targets: ["hs1", 'hs2'],
					},
				],
			},
		),
		detail: {
			description:
				"Send a message to a room. The sender must be the user ID. The target must be the server name.",
		},
	});
