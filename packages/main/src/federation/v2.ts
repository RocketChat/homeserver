import { Elysia } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { inviteEndpoint } from "../routes/invite/v2/invite";

export const v2Endpoints = new Elysia()
    .group('_matrix/federation/v2', (matrixFederationV2) =>
        matrixFederationV2.use(inviteEndpoint)
    )
