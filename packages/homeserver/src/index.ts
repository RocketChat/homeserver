import swagger from "@elysiajs/swagger";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { app } from "./app";
import { routerWithMongodb } from "./plugins/mongodb";
import { getKeyPair } from "./keys";

app
	.use(swagger())
	.get("/", () => "")
	.onError(async ({ error, request }) => {
		if (!request.body) {
			return;
		}

		const body = await new Response(request.body).text();

		console.log("url ->", request.url);
		console.log("body ->", body);

		return error;
	});

export { app, getKeyPair };
