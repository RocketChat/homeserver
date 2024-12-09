import { logger } from "@bogeychan/elysia-logger";
import { Elysia } from "elysia";

import { BadJSONError, MatrixError } from "./errors";
import federationEndpoints from "./routes/federation";
import { keyV2Endpoints } from "./routes/key/server";
import type { ElysiaRoutes } from "./extractRouteTypings";

export const app = new Elysia({
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
	.onError(async ({ code }) => {
		if (code === "NOT_FOUND") {
			return {
				errcode: "M_UNRECOGNIZED",
				error: "Unrecognized request",
			};
		}
	});

export type HomeServerRoutes = ElysiaRoutes<typeof app>;
