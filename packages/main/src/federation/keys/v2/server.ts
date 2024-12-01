import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { cache } from "../../../cache";
import { config } from "../../../config";
import { signJson } from "../../../signJson";
import { unpaddedBase64 } from "../../../unpaddedBase64";

export const keyV2Endpoints = new Elysia({ prefix: "/_matrix/key/v2" }).get(
  "/server",
  cache(async () => {
    const keys = Object.fromEntries(
      config.signingKey.map(({ algorithm, version, publicKey }) => [
        `${algorithm}:${version}`,
        {
          key: unpaddedBase64(publicKey),
        },
      ])
    );

    return config.signingKey.reduce(
      async (json, signingKey) => signJson(await json, signingKey, config.name),
      Promise.resolve({
        old_verify_keys: {},
        server_name: config.name,
        // 1 day
        signatures: {},
        valid_until_ts: new Date().getTime() + 60 * 60 * 24 * 1000,
        verify_keys: keys,
      })
    );
  }, 1000 * 60 * 60),
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
);
