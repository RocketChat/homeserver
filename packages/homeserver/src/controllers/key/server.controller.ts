import { federationSDK } from '@rocket.chat/federation-sdk';
import type { Elysia } from 'elysia';
import { ServerKeyResponseDto } from '../../dtos';

export const serverKeyPlugin = (app: Elysia) => {
	return app.get(
		'/_matrix/key/v2/server',
		async () => {
			return federationSDK.getOwnSignedServerKeyResponse();
		},
		{
			response: {
				200: ServerKeyResponseDto,
			},
			detail: {
				tags: ['Key'],
				summary: 'Get server key',
				description: 'Get the server key',
			},
		},
	);
};
