import { Elysia } from "elysia";

import { inviteEndpoint } from "./invite";
import { queryEndpoints } from "./query";
import { usersEndpoints } from "./users";
import { versionEndpoints } from "./version";

const federationV1Endpoints = new Elysia({
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

const federationV2Endpoints = new Elysia({
	prefix: "/_matrix/federation/v2",
}).use(inviteEndpoint);

export default new Elysia()
	.use(federationV1Endpoints)
	.use(federationV2Endpoints);
