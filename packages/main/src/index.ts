import { Elysia, t } from "elysia";
import { logger } from "@bogeychan/elysia-logger";
import swagger from "@elysiajs/swagger";

import {
  EndpointsByMethod,
  GetUrlParams,
  ResponseByMethod,
  Method,
  ParametersByMethod,
} from "@hs/endpoints/src/endpoints";
import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { signJson } from "./signJson";
import { config } from "./config";
import { cache } from "./cache";
import { authorizationHeaders } from "./authentication";

type Routing<TMethod extends Method> = {
  [TPath in EndpointsByMethod[TMethod]]: HandlerResponse<TMethod, TPath>;
};

type HandlerResponse<
  TMethod extends Method,
  TPath extends EndpointsByMethod[TMethod]
> = {
  validateBody: (body: any) => body is ParametersByMethod<TMethod, TPath>;
  validateQuery: (query: any) => query is GetUrlParams<TMethod, TPath>;
  validateResponse: (
    response: any
  ) => response is ResponseByMethod<TMethod, TPath>;
  handler: Routing<TMethod>[TPath];
};

const app = new Elysia();

console.log(config);
app
  .use(swagger())
  .use(
    logger({
      level: "debug",
    })
  )
  .get("/", () => "")
  .group("/_matrix/key/v2", (matrixKeyV2) =>
    matrixKeyV2.get(
      "/server",
      cache(
        async () =>
          config.signingKey.reduce(
            async (json, signingKey) =>
              signJson(await json, signingKey, config.name),
            Promise.resolve({
              server_name: config.name,
              // 1 day
              valid_until_ts: new Date().getTime() + 60 * 60 * 24 * 1000,
              old_verify_keys: {},
              verify_keys: {
                ...Object.fromEntries(
                  config.signingKey.map(({ algorithm, version }) => [
                    `${algorithm}:${version}`,
                    {
                      key: algorithm,
                    },
                  ])
                ),
              },
              signatures: {},
            })
          ),
        1000 * 60 * 60
      ),

      {
        response: {
          200: t.Object({
            server_name: t.String(),
            valid_until_ts: t.Number(),
            old_verify_keys: t.Record(
              t.String(),
              t.Object({
                expired_ts: t.Number(),
                key: t.String(),
              })
            ),
            verify_keys: t.Record(
              t.String(),
              t.Object({
                key: t.String(),
              })
            ),
            signatures: t.Record(
              t.String(),
              t.Record(
                t.String(),
                t.String({
                  description:
                    "A signature of the server's public key by the key id",
                })
              ),
              {
                description: `Digital signatures for this object signed using the verify_keys. The signature is calculated using the process described at Signing JSON`,
              }
            ),
          }),
        },
      }
    )
  )
  .group('_matrix/federation/v2', (matrixFederationV2) =>
    matrixFederationV2
      .put('/invite/:roomId/:eventId', ({ params, body }) => {

        setTimeout(async () => {
          const { event } = body as any;

          const auth = await authorizationHeaders(
            config.name,
            config.signingKey[0].base64PublicKey,
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
  )
  .group('_matrix/federation/v1', (matrixFederationV1) =>
    matrixFederationV1
      .get('/version', () => {
          return {
            server: {
              name: config.name,
              version: config.version,
            }
          }
        }, {
          response: {
            200: t.Object({
              server: t.Object({
                name: t.String(),
                version: t.String(),
              }),
            }),
          },
        })
      .get('/query/profile', ({ query }) => ({
        "avatar_url": "mxc://matrix.org/MyC00lAvatar",
        "displayname": String(query.user_id).toUpperCase()
      }))
      .post('/user/keys/query', ({ body }) => {
        const keys = Object.keys(body.device_keys).reduce((v, cur) => {
          v[cur] = 'unknown_key';

          return v;
        }, {} as any);

        return {
          "device_keys": keys
        };
      }, {
        body: t.Object({
          device_keys: t.Any(),
        }),
        response: t.Object({
          device_keys: t.Any(),
        })
      })
  )
  .onError(async ({ error, request }) => {
    if (!request.body) {
      return;
    }

    const body = await new Response(request.body).text();

    console.log('url ->', request.url);
    console.log('body ->', body);

    return error;
  })

  .listen(config.port);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);

