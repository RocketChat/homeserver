import { Elysia } from "elysia";

import { getServerKeyRoute } from "./getServerKey";

export const keyV2Endpoints = new Elysia({ prefix: "/_matrix/key/v2" }).use(
	getServerKeyRoute,
);
