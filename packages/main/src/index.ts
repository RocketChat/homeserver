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
import { config } from "./config";
import { authorizationHeaders } from "./authentication";
import { keyV2Endpoints } from "./routes/keys/v2/server";
import { v2Endpoints } from "./routes/federation/v2";
import { v1Endpoints } from "./routes/federation/v1";

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
  .use(keyV2Endpoints)
  .use(v2Endpoints)
  .use(v1Endpoints)
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

