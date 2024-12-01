import { Elysia } from "elysia";
import { logger } from "@bogeychan/elysia-logger";
import { config } from "./config";

import { keyV2Endpoints } from "./routes/key/v2";
import { federationV1Endpoints } from "./routes/federation/v1";
import { federationV2Endpoints } from "./routes/federation/v2";
import { fakeEndpoints } from "./routes/fake/room";
import { BadJSONError, MatrixError } from "./errors";

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
	.use(federationV2Endpoints)
	.use(federationV1Endpoints)
	.use(fakeEndpoints)
	.onError(async ({ code }) => {
		if (code === "NOT_FOUND") {
			return {
				errcode: "M_UNRECOGNIZED",
				error: "Unrecognized request",
			};
		}
	});
