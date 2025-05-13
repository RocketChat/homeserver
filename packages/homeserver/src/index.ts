import swagger from "@elysiajs/swagger";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import Elysia from "elysia";
import { app as r } from "./app";
import { getKeyPair } from "./keys";

const app = new Elysia({
	handler: {
		standardHostname: false,
	},
})
	.use(swagger({
		documentation: {
			components: {
				securitySchemes: {
					matrixAuth: {
						type: 'apiKey',
						name: 'Authorization',
						in: 'header'
					}
				}
			}
		}
	}))
	.get("/", () => "")
	.onError(async ({ error, request }) => {
		if (!request.body) {
			return;
		}

		const body = await new Response(request.body).text();

		console.log("url ->", request.url);
		console.log("body ->", body);

		return error;
	})
	.use(r);
	
export { app, getKeyPair };
