import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { isConfigContext } from "../../plugins/isConfigContext";
import { isMongodbContext } from "../../plugins/isMongodbContext";

// PUT uri: `/_matrix/federation/v1/send_join/${params.roomId}/${event.state_key}?omit_members=true`,

export const sendJoinEndpoint = new Elysia().put(
	"/send_join/:roomId/:stateKey",
	async ({ params, body, ...context }) => {
		if (!isConfigContext(context)) {
			throw new Error("No config context");
		}
		if (!isMongodbContext(context)) {
			throw new Error("No mongodb context");
		}
		const {
			config,
			mongo: { eventsCollection },
		} = context;

		const roomId = decodeURIComponent(params.roomId);
		const stateKey = decodeURIComponent(params.stateKey);
		const event = body as any;

		console.log("sendJoin ->", { roomId, stateKey });
		console.log("sendJoin ->", { body });

		const records = await eventsCollection
			.find({ "event.room_id": roomId }, { sort: { "event.depth": 1 } })
			.toArray();

		const events = records.map((event) => event.event);

		const lastInviteEvent = records.find(
			(record) =>
				record.event.type === "m.room.member" &&
				record.event.content.membership === "invite",
			// event.state_key === stateKey,
		);

		// console.log("lastEvent ->", lastEvent);

		// const joinEvent = events.pop();
		const result = {
			event: {
				...event,
				unsigned: lastInviteEvent && {
					replaces_state: lastInviteEvent._id,
					prev_content: lastInviteEvent.event.content,
					prev_sender: lastInviteEvent.event.sender,
				},
			},
			state: events,
			auth_chain: events.filter((event) => event.depth <= 4),
			// auth_chain: [],
			members_omitted: false,
			origin: config.name,
		};

		console.log("sendJoin result ->", result);

		if (!(await eventsCollection.findOne({ _id: stateKey }))) {
			await eventsCollection.insertOne({
				_id: stateKey,
				event,
			});
		}

		return result;
	},
	{
		params: t.Object(
			{
				roomId: t.String({
					// description: "The room ID that the user is being invited to.",
				}),
				stateKey: t.String({
					// description:
					// 	"The user ID for the invite event, generated by the inviting server.",
				}),
			},
			{
				examples: [
					{
						roomId: "!abc123:matrix.org",
						userId: "@admin:example.org",
					},
				],
			},
		),
	},
);
