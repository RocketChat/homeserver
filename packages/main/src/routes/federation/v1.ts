import { Elysia } from "elysia";

import { queryEndpoints } from "./v1/query";
import { usersEndpoints } from "./v1/users";
import { versionEndpoints } from "./v1/version";

export const federationV1Endpoints = new Elysia({
	prefix: "/_matrix/federation/v1",
})
	.use(versionEndpoints)
	.use(usersEndpoints)
	.use(queryEndpoints)
	.put("/send/:txnId", ({ params, body }) => {
		console.log("receive send ->", params);
		console.log("body ->", body);

		return {
			[params.txnId]: {},
		};
	});
