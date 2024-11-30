import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { versionEndpoints } from "./version";
import { usersEndpoints } from "./users";
import { profileEndpoints } from "./profile";

export const v1Endpoints = new Elysia()
    .group('_matrix/federation/v1', (matrixFederationV1) =>
        matrixFederationV1.use(versionEndpoints)
            .use(usersEndpoints)
            .use(profileEndpoints)
    )
