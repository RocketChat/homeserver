import Elysia, { t } from "elysia";
import { config } from "../../../config";

export const versionEndpoints = new Elysia().get(
	"/version",
	() => {
		return {
			server: {
				name: config.name,
				version: config.version,
			},
		};
	},
	{
		response: {
			200: t.Object({
				server: t.Object({
					name: t.String(),
					version: t.String(),
				}),
			}),
		},
	},
);
