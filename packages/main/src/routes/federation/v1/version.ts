import Elysia, { t } from "elysia";
import { config } from "../../../config";

export const versionEndpoints = new Elysia().get(
	"/version",
	() => ({
		server: {
			name: config.name,
			version: config.version,
		},
	}),
	{
		response: t.Object({
			server: t.Object({
				name: t.String(),
				version: t.String(),
			}),
		}),
	},
);
