import { Elysia } from "elysia";

import { queryEndpoints } from "./query";
import { usersEndpoints } from "./users";
import { versionEndpoints } from "./version";

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



import { inviteEndpoint } from "./invite";

export const federationV2Endpoints = new Elysia({
	prefix: "/_matrix/federation/v2",
}).use(inviteEndpoint);
