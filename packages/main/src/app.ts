import { Elysia } from "elysia";
import { config } from "./config";

import { keyV2Endpoints } from "./federation/keys/v2/server";
import { v1Endpoints } from "./federation/v1";
import { v2Endpoints } from "./federation/v2";

export const app = new Elysia(config)
	.use(keyV2Endpoints)
	.use(v2Endpoints)
	.use(v1Endpoints);
