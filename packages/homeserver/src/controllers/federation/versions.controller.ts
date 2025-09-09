import { ConfigService } from '@hs/federation-sdk';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { GetVersionsResponseDto } from '../../dtos';

export const versionsPlugin = (app: Elysia) => {
	const configService = container.resolve(ConfigService);
	return app.get(
		'/_matrix/federation/v1/version',
		() => {
			return {
				server: {
					name: configService.serverName,
					version: configService.version,
				},
			};
		},
		{
			response: {
				200: GetVersionsResponseDto,
			},
			detail: {
				tags: ['Federation'],
				summary: 'Get versions',
				description: 'Get the versions of the server',
			},
		},
	);
};
