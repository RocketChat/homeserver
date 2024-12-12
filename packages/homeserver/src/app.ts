import { logger } from "@bogeychan/elysia-logger";
import { Elysia } from "elysia";

import { BadJSONError, MatrixError, UnrecognizedError } from "./errors";
import federationEndpoints from "./routes/federation";
import { keyV2Endpoints } from "./routes/key/server";
import type { ElysiaRoutes } from "./extractRouteTypings";
import { wellKnownEndpoint } from "./routes/well-known";

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

		if (code === "NOT_FOUND") {
			const newError = UnrecognizedError.notImplemented("Unrecognized request");
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
	.use(wellKnownEndpoint);

export type HomeServerRoutes = ElysiaRoutes<typeof app>;
