import { Elysia } from "elysia";

import { inviteEndpoint } from "./invite";
import { queryEndpoints } from "./query";
import { usersEndpoints } from "./users";
import { versionEndpoints } from "./version";
import { makeJoinEndpoint } from "./makeJoin";
import { sendJoinEndpoint } from "./sendJoin";
import { getMissingEventsRoute } from "./getMissingEvents";
import validateHeaderSignature from "../../plugins/validateHeaderSignature";
import { isMongodbContext } from "../../plugins/isMongodbContext";
import { generateId } from "../../authentication";

const federationV1Endpoints = new Elysia({
	prefix: "/_matrix/federation/v1",
})
	.use(versionEndpoints)
	.onBeforeHandle(validateHeaderSignature)
	.use(usersEndpoints)
	.use(queryEndpoints)
	.use(makeJoinEndpoint)
	.use(getMissingEventsRoute)
	.put("/send/:txnId", async ({ params, body, ...context }) => {
		console.log("receive send ->", params);
		console.log("body ->", body);

		if (!isMongodbContext(context)) {
			throw new Error("No mongodb context");
		}

		const {
			mongo: { eventsCollection },
		} = context;

		const { pdus } = body as any;

		if (pdus) {
			await eventsCollection.insertMany(
				pdus.map((event: any) => ({
					_id: generateId(event),
					event,
				}))
			);
		}

		return {
			[params.txnId]: {},
		};
	});

const federationV2Endpoints = new Elysia({
	prefix: "/_matrix/federation/v2",
})
	.use(inviteEndpoint)
	.use(sendJoinEndpoint);

export default new Elysia()
	.use(federationV1Endpoints)
	.use(federationV2Endpoints);

// export default new Elysia();
