import { Elysia, t } from "elysia";
import { etag } from '@bogeychan/elysia-etag'
import { isConfigContext } from "../plugins/isConfigContext";

export const wellKnownEndpoint = new Elysia()
    .use(etag())
    .get(
        "/.well-known/matrix/server",
        async (context) => {
            if (!isConfigContext(context)) {
                throw new Error("No config context");
            }
            const { config } = context;
            const response = {
                'm.server': `${config.name}:443`,
            }

            context.setETag(new Bun.CryptoHasher('md5').update(JSON.stringify(response)).digest('hex'));
            context.set.headers['Content-Type'] = 'application/octet-stream';

            return response;
        },
        {
            response: t.Object(
                {
                    'm.server': t.String({
                        description:
                            "The server name and port that clients should use when connecting to the homeserver.",
                        examples: ["example.org:443"],
                    }),
                },
            ),
        },
    );
