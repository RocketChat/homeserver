import swagger from "@elysiajs/swagger";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { app } from "./app";
import { config } from "./config";
import { routerWithConfig } from "./plugins/config";
import { routerWithMongodb } from "./plugins/mongodb";

console.log(config);

app
	.use(swagger())
	.use(routerWithMongodb)
	.use(routerWithConfig)
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
	.listen(config.port, () => {
		console.log(
			`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
		);
	});
