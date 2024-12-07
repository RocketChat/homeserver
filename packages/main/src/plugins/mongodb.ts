import Elysia from "elysia";
import type { InferContext } from "elysia";

import * as mongodb from "../mongodb";

export const routerWithMongodb = new Elysia().decorate("mongo", mongodb);

export type Context = InferContext<typeof routerWithMongodb>;
