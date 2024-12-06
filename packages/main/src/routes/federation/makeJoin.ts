import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { isConfigContext } from "../../plugins/config";
import { roomMemberEvent } from "../../events/m.room.member";
import { signEvent } from "../../signEvent";
import { generateId } from "../../authentication";

// "method":"GET",
// "url":"http://rc1:443/_matrix/federation/v1/make_join/%21kwkcWPpOXEJvlcollu%3Arc1/%40admin%3Ahs1?ver=1&ver=2&ver=3&ver=4&ver=5&ver=6&ver=7&ver=8&ver=9&ver=10&ver=11&ver=org.matrix.msc3757.10&ver=org.matrix.msc3757.11",

export const makeJoinEndpoint = new Elysia().get(
	"/make_join/:roomId/:userId",
	async ({ params, query, ...context }) => {
		if (!isConfigContext(context)) {
			throw new Error("No config context");
		}
		const {
			config,
		} = context;
		const roomId = decodeURIComponent(params.roomId);
		const userId = decodeURIComponent(params.userId);

		console.log("make_join params received ->", { roomId, userId });

		const { eventsCollection } = await import("../../mongodb");
		const [lastEvent] = await eventsCollection
			.find(
				{ "event.room_id": roomId },
				{ sort: { "event.depth": -1 }, limit: 1 },
			)
			.toArray();

		const authEvents = await eventsCollection
			.find(
				{
					"event.room_id": roomId,
					$or: [
						{
							"event.type": {
								$in: [
									"m.room.create",
									"m.room.power_levels",
									"m.room.join_rules",
								],
							},
						},
						{
							// Lots of room members, when including the join ones it fails the auth check
							"event.type": "m.room.member",
							"event.content.membership": "invite",
						},
					],
				},
				{
					projection: {
						_id: 1,
					},
				},
			)
			.toArray();

		console.log("lastEvent ->", lastEvent);

		const event = roomMemberEvent({
			membership: "join",
			roomId,
			sender: userId,
			state_key: userId,
			auth_events: [...authEvents].map((event) => event._id),
			prev_events: [lastEvent._id],
			depth: lastEvent.event.depth + 1,
			origin: config.name,
			ts: Date.now(),
		});

		const signedEvent = await signEvent(event, config.signingKey[0]);

		const eventId = await generateId(signedEvent);

		console.log("eventId ->", eventId);

		const result = {
			event: event,
			room_version: "10",
		};

		console.log("make_join result ->", result);

		// // TODO: how to prevent duplicates?
		// await eventsCollection.insertOne({
		// 	_id: eventId,
		// 	event: signedEvent,
		// });

		return result;
	},
	{
		params: t.Object(
			{
				roomId: t.String({
					// description: "The room ID that the user is being invited to.",
				}),
				userId: t.String({
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
