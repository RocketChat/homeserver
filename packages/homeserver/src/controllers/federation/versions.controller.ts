import { Elysia } from "elysia";
import { container } from "tsyringe";
import { ConfigService } from "../../services/config.service";

export const versionsPlugin = (app: Elysia) => {
	const configService = container.resolve(ConfigService);
	return app.get("/_matrix/federation/v1/version", () => {
		const config = configService.getServerConfig();
		return {
			server: {
				name: config.name,
				version: config.version,
			},
		};
	});
};
