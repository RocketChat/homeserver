import Elysia, { t } from "elysia";
import { EventBaseDTO } from "../../dto";
import type { EventBase } from "@hs/core/src/events/eventBase";

export const eventAuth = new Elysia().get(
	"/event_auth/:roomId/:eventId",
	async () => {
		return {
			auth_chain: [] as (typeof EventBaseDTO.static)[],
		};
	},
	{
		response: {
			200: t.Object({
				auth_chain: t.Array(EventBaseDTO),
			}),
		},
	},
);
