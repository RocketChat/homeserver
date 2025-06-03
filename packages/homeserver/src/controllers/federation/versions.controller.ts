import { Elysia } from "elysia";
import { container } from "tsyringe";
import { GetVersionsResponseDto } from "../../dtos";
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
	}, {
		response: {
			200: GetVersionsResponseDto,
		},
		detail: {
			tags: ['Federation'],
			summary: 'Get versions',
			description: 'Get the versions of the server'
		}
	});
};
