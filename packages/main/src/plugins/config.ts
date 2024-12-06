import Elysia from "elysia";
import type { InferContext } from "elysia";

import { config } from "../config";

export const routerWithConfig = new Elysia().decorate("config", config);

export type Context = InferContext<typeof routerWithConfig>;

export const isConfigContext = <T extends object>(
	context: T,
): context is T & Context => "config" in context;
