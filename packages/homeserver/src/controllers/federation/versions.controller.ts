import { federationSDK } from '@rocket.chat/federation-sdk';
import { Elysia } from 'elysia';
import { GetVersionsResponseDto } from '../../dtos';

export const versionsPlugin = (app: Elysia) => {
	const config = federationSDK.getConfig();

	return app.get(
		'/_matrix/federation/v1/version',
		() => {
			return {
				server: {
					name: config.serverName,
					version: config.version,
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
