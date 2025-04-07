import Elysia from "elysia";
import type { InferContext } from "elysia";
import type { SigningKey } from "../keys";

export interface Config {
	path: string;
	signingKeyPath: string;
	port: number;
	signingKey: SigningKey[];
	name: string;
	version: string;
	tls: {
		cert: string;
		key: string;
	}
}

export const routerWithConfig = new Elysia().decorate("config", {} as Config);

export type Context = InferContext<typeof routerWithConfig>;
