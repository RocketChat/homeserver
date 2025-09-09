import { ServerService } from '@hs/federation-sdk';
import type { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { ServerKeyResponseDto } from '../../dtos';

export const serverKeyPlugin = (app: Elysia) => {
	const serverService = container.resolve(ServerService);
	return app.get(
		'/_matrix/key/v2/server',
		async () => {
			return serverService.getSignedServerKey();
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
