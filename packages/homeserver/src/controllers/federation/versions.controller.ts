import { federationSDK } from '@rocket.chat/federation-sdk';
import { Elysia } from 'elysia';
import { GetVersionsResponseDto } from '../../dtos';

export const versionsPlugin = (app: Elysia) => {
	const serverName = federationSDK.getConfig('serverName');
	const version = federationSDK.getConfig('version');

	return app.get(
		'/_matrix/federation/v1/version',
		() => {
			return {
				server: {
					name: serverName,
					version: version,
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
