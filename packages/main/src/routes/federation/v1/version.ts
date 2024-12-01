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
		response: t.Object(
			{
				server: t.Object({
					name: t.String({ examples: ["My_Homeserver_Implementation"] }),
					version: t.String({ examples: ["ArbitraryVersionNumber", "axp"] }),
				}),
			},
			{
				description: "The implementation name and version of this homeserver.",
			},
		),
		detail: {
			description:
				"Get the implementation name and version of this homeserver.",
			operationId: "getVersion",
		},
	},
);
