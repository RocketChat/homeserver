import { Elysia } from "elysia";
import { logger } from "@bogeychan/elysia-logger";
import { config } from "./config";

import { keyV2Endpoints } from "./federation/keys/v2/server";
import { v1Endpoints } from "./federation/v1";
import { v2Endpoints } from "./federation/v2";
import { fakeEndpoints } from "./routes/fake/room";

export const app = new Elysia({
	name: config.name,
	handler: {
		standardHostname: false,
	},
})
	.use(
		logger({
			level: "debug",
		}),
	)
	.use(keyV2Endpoints)
	.use(v2Endpoints)
	.use(v1Endpoints)
	.use(fakeEndpoints)
	.onError(async ({ code }) => {
		if (code === "NOT_FOUND") {
			return {
				errcode: "M_UNRECOGNIZED",
				error: "Unrecognized request",
			};
		}
	});
