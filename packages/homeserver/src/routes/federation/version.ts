import Elysia, { t } from "elysia";
import { isConfigContext } from "../../plugins/isConfigContext";

export const versionEndpoints = new Elysia().get(
	"/version",
	(context) => {
		if (!isConfigContext(context)) {
			throw new Error("No config context");
		}
		const { config } = context;

		return {
			server: {
				name: config.name,
				version: config.version,
			},
		};
	},
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
