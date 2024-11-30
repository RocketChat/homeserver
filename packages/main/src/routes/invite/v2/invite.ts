import { Elysia } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { config } from "../../../config";
import { signJson } from "../../../signJson";
import { authorizationHeaders } from "../../../authentication";

const makeRequest = async ({ method, domain, uri, options = {} }: { method: string; domain: string; uri: string; options?: Record<string, any>; }) => {
  // const signedJson = await signJson(
  //   {
  //     method,
  //     uri,
  //     origin,
  //     destination: origin,
  //     ...(options.body && { content: options.body }),
  //     signatures: {},
  //   },
  //   config.signingKey[0],
  //   origin
  // );

  const signingKey = config.signingKey[0];

  const signatures = await authorizationHeaders(
    config.name,
    signingKey,
    domain,
    method,
    uri,
    options.body,
  );

  // console.log('origin ->', origin);
  console.log('signatures ->', signatures);

  const key = `${signingKey.algorithm}:${signingKey.version}`;
  const signed = signatures[config.name][key];

  const auth = `X-Matrix origin="${config.name}",destination="${domain}",key="${key}",sig="${signed}"`;

  console.log("auth ->", auth);

  const body = (options.body && {
    body: JSON.stringify(
      {
        ...options.body,
        signatures,
      }
    ),
  });

  console.log('body ->', body);

  return fetch(`https://${domain}${uri}`, {
    ...options,
    ...body,
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

      const response = await makeRequest({
        method: 'GET',
        domain: event.origin,
        uri: `/_matrix/federation/v1/make_join/${params.roomId}/${event.state_key}?ver=10`
      });

      const responseMake = await response.json();
      console.log("make_join ->", responseMake);

      const responseSend = await makeRequest({
          method: 'PUT',
          domain: event.origin,
          uri: `/_matrix/federation/v1/send_join/${params.roomId}/${event.state_key}?omit_members=true`,
          options: {
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
