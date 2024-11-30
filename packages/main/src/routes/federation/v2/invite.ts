import { Elysia } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { config } from "../../../config";
import { signJson } from "../../../signJson";
import { authorizationHeaders } from "../../../authentication";

const makeRequest = async ({ method, origin, uri, options = {} }: { method: string; origin: string; uri: string; options?: Record<string, any>; }) => {
  const auth = await authorizationHeaders(
    config.name,
    config.signingKey[0],
    origin,
    method,
    uri,
    ...(options.body && { content: options.body }),
  );

  console.log("auth ->", auth);

  return fetch(`https://${origin}${uri}`, {
    ...options,
    ...(options.body && { body: JSON.stringify(options.body) }),
    method,
    headers: {
      Authorization: auth,
    },
  });
}

export const inviteEndpoint = new Elysia().put(
  "/invite/:roomId/:eventId",
  ({ params, body }) => {
    setTimeout(async () => {
      const { event } = body as any;

      const response = await makeRequest({ method: 'GET', origin: event.origin, uri: `/_matrix/federation/v1/make_join/${params.roomId}/${event.state_key}?ver=10` });

      const responseMake = await response.json();
      console.log("make_join ->", responseMake);

      const responseSend = await makeRequest({
          method: 'PUT', origin: event.origin, uri: `/_matrix/federation/v1/send_join/${params.roomId}/${event.state_key}?ver=10`, options: {
            body: responseMake.event,
          }
        });

      const responseBody = await responseSend.json();

      console.log("send_join ->", responseBody);
    }, 1000);

    return config.signingKey.reduce(
      (json: any, signingKey) => signJson(json, signingKey, config.name),
      body
    );
  }
);
