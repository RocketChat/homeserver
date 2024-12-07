import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { isMongodbContext } from "../../plugins/isMongodbContext";

//POST http://rc1:443/_matrix/federation/v1/get_missing_events/%21EiexWZWYPDXWLzPRCq%3Arc1

export const getMissingEvents = new Elysia().post(
	"/get_missing_events/:roomId",
	async ({ params, body, ...context }) => {
		if (!isMongodbContext(context)) {
			throw new Error("No mongodb context");
		}
		const {
			mongo: { eventsCollection },
		} = context;
		const roomId = decodeURIComponent(params.roomId);

		console.log("get_missing_events ->", { roomId });
		console.log("get_missing_events ->", { body });

		console.log({
			_id: { $in: [...body.earliest_events, ...body.latest_events] },
			"event.room_id": roomId,
		});

		const depths = await eventsCollection
			.find(
				{
					_id: { $in: [...body.earliest_events, ...body.latest_events] },
					"event.room_id": roomId,
				},
				{ projection: { "event.depth": 1 } },
			)
			.toArray()
			.then((events) => events.map((event) => event.event.depth));

		if (depths.length === 0) {
			console.log("get_missing_events depths -> No events found");
			return {
				events: [],
			};
		}

		console.log("get_missing_events depths ->", depths);

		const minDepth = Math.min(...depths);
		const maxDepth = Math.max(...depths);

		console.log("get_missing_events depths ->", { minDepth, maxDepth });

		const events = await eventsCollection
			.find(
				{
					"event.room_id": roomId,
					"event.depth": { $gte: minDepth, $lte: maxDepth },
				},
				{ limit: body.limit, sort: { "event.depth": 1 } },
			)
			.toArray()
			.then((events) => events.map((event) => event.event));

		const result = {
			events,
		};

		console.log("get_missing_events result ->", result);

		return result;
	},
	{
		params: t.Object(
			{
				roomId: t.String({
					// description: "The room ID that the user is being invited to.",
				}),
			},
			{
				examples: [
					{
						roomId: "!abc123:matrix.org",
					},
				],
			},
		),
		body: t.Object(
			{
				earliest_events: t.Array(t.String()),
				latest_events: t.Array(t.String()),
				limit: t.Number(),
				min_depth: t.Number(),
			},
			{
				examples: [
					{
						earliest_events: ["$x_D98hd6QkvpHVoGrxh7zNBLeumy7E1HyiBUcpWO870"],
						latest_events: ["$T3BWmVrmQziGp8l3Za66o_cIOH8sH-NT2_Vkf_XDcE4"],
						limit: 10,
						min_depth: 0,
					},
				],
			},
		),
	},
);
