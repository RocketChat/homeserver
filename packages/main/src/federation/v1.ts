import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { versionEndpoints } from "../routes/version/v1/version";
import { usersEndpoints } from "../routes/users/v1/users";
import { profileEndpoints } from "../routes/profile/v1/profile";

export const v1Endpoints = new Elysia()
    .group('_matrix/federation/v1', (matrixFederationV1) =>
        matrixFederationV1.use(versionEndpoints)
            .use(usersEndpoints)
            .use(profileEndpoints)
            .put('/send/:txnId', ({ params, body }) => {
                console.log('receive send ->', params);
                console.log('body ->', body);

                return {
                    [params.txnId]: {},
                };
            })
    )
