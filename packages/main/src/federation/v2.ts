import { Elysia } from "elysia";

import { inviteEndpoint } from "../routes/invite/v2/invite";

export const v2Endpoints = new Elysia({ prefix: "/_matrix/federation/v2" }).use(
  inviteEndpoint
);
