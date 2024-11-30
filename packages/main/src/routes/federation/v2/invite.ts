import { Elysia } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { config } from "../../../config";
import { signJson } from "../../../signJson";
import { authorizationHeaders } from "../../../authentication";

export const inviteEndpoint = new Elysia()
    .put('/invite/:roomId/:eventId', ({ params, body }) => {

        setTimeout(async () => {
            const { event } = body as any;

            const auth = await authorizationHeaders(
                config.name,
                config.signingKey[0],
                event.origin,
                "GET",
                `/_matrix/federation/v1/make_join/${params.roomId}/${event.sender}`
            );

            console.log('auth ->', auth);

            const response = await fetch(`https://${event.origin}/_matrix/federation/v1/make_join/${params.roomId}/${event.sender}`, {
                method: "GET",
                headers: {
                    "Authorization": auth
                }
            });

            const responseBody = await response.json();

            console.log('make_join ->', responseBody);
        }, 10000);

        return config.signingKey.reduce(
            (json: any, signingKey) => signJson(json, signingKey, config.name),
            body
        );
    })
