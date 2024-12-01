import { Elysia } from "elysia";

import { inviteEndpoint } from "./v2/invite";

export const federationV2Endpoints = new Elysia({
	prefix: "/_matrix/federation/v2",
}).use(inviteEndpoint);
