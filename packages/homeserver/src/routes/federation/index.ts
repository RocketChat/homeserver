import { Elysia } from "elysia";

import { sendInviteV2Route } from "./sendInviteV2";
import { queryProfileRoute } from "./queryProfile";
import { getUserDevicesRoute } from "./getUserDevices";
import { queryUserEncryptionKeysRoute } from "./queryUserEncryptionKeys";
import { getVersionRoute } from "./getVersion";
import { makeJoinRoute } from "./makeJoin";
import { sendJoinV2Route } from "./sendJoinV2";
import { getMissingEventsRoute } from "./getMissingEvents";
import validateHeaderSignature from "../../plugins/validateHeaderSignature";
import { sendTransactionRoute } from "./sendTransaction";
import { eventAuth } from "./eventAuth";

const federationV1Endpoints = new Elysia({
	prefix: "/_matrix/federation/v1",
})
	.use(getVersionRoute)
	.onBeforeHandle(validateHeaderSignature)
	.use(queryUserEncryptionKeysRoute)
	.use(getUserDevicesRoute)
	.use(queryProfileRoute)
	.use(makeJoinRoute)
	.use(getMissingEventsRoute)
	.use(sendTransactionRoute)
	.use(eventAuth);

const federationV2Endpoints = new Elysia({
	prefix: "/_matrix/federation/v2",
})
	.use(sendInviteV2Route)
	.use(sendJoinV2Route);

export default new Elysia()
	.use(federationV1Endpoints)
	.use(federationV2Endpoints);

// export default new Elysia();
