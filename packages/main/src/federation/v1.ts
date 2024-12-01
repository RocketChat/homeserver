import { Elysia } from "elysia";

import { profileEndpoints } from "../routes/profile/v1/profile";
import { usersEndpoints } from "../routes/users/v1/users";
import { versionEndpoints } from "../routes/version/v1/version";

export const v1Endpoints = new Elysia({ prefix: "/_matrix/federation/v1" })
	.use(versionEndpoints)
	.use(usersEndpoints)
	.use(profileEndpoints)
	.put("/send/:txnId", ({ params, body }) => {
		console.log("receive send ->", params);
		console.log("body ->", body);

		return {
			[params.txnId]: {},
		};
	});
