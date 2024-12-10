import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { isMongodbContext } from "../../plugins/isMongodbContext";
import { makeGetMissingEventsProcedure } from "../../procedures/getMissingEvents";

//POST http://rc1:443/_matrix/federation/v1/get_missing_events/%21EiexWZWYPDXWLzPRCq%3Arc1

export const getMissingEventsRoute = new Elysia().post(
	"/get_missing_events/:roomId",
	async ({ params, body, ...context }) => {
		if (!isMongodbContext(context)) {
			throw new Error("No mongodb context");
		}
		const roomId = decodeURIComponent(params.roomId);

		const {
			mongo: { getDeepEarliestAndLatestEvents, getMissingEventsByDeep },
		} = context;

		const getMissingEvents = makeGetMissingEventsProcedure(
			getDeepEarliestAndLatestEvents,
			getMissingEventsByDeep,
		);

		const events = await getMissingEvents(
			roomId,
			body.earliest_events,
			body.latest_events,
			body.limit,
		);

		return {
			events,
		};
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
		detail: {
			security: [{
				'matrixAuth': []
			}],
		}
	},
);
