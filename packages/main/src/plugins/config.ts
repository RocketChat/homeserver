import Elysia from "elysia";
import type { InferContext } from "elysia";

import { config } from "../config";

export const routerWithConfig = new Elysia().decorate("config", config);

export type Context = InferContext<typeof routerWithConfig>;
