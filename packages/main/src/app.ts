import { Elysia } from "elysia";
import { logger } from "@bogeychan/elysia-logger";
import { config } from "./config";

import { keyV2Endpoints } from "./routes/key/server";
import { fakeEndpoints } from "./routes/fake/room";
import { BadJSONError, MatrixError } from "./errors";
import federationEndpoints from "./routes/federation";

export const app = new Elysia({
	name: config.name,
	handler: {
		standardHostname: false,
	},
})
	.onError(({ code, error, set }) => {
		if (error instanceof MatrixError) {
			return error.toJSON();
		}

		if (code === "VALIDATION") {
			const newError = new BadJSONError(
				error.validator.Errors(error.value).First().message,
			);
			set.status = newError.status;
			return newError.toJSON();
		}
	})
	.use(
		logger({
			level: "debug",
		}),
	)
	.use(keyV2Endpoints)
	.use(federationEndpoints)
	.use(fakeEndpoints)
	.onError(async ({ code }) => {
		if (code === "NOT_FOUND") {
			return {
				errcode: "M_UNRECOGNIZED",
				error: "Unrecognized request",
			};
		}
	});
