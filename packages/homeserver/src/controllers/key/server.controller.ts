import { ServerService } from '@hs/federation-sdk';
import { KeyService } from '@hs/federation-sdk';
import { type Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import { ServerKeyResponseDto } from '../../dtos';

export const serverKeyPlugin = (app: Elysia) => {
	const serverService = container.resolve(ServerService);
	const keyService = container.resolve(KeyService);
	return app
		.get(
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
		)
		.post(
			'/_matrix/key/v2/query',
			async ({ body }: any) => {
				const resp = await keyService.handleQuery(body);
				return resp;
			},
			{
				body: t.Any(),
			},
		)
		.get(
			'/_matrix/key/v2/query/:serverName',
			async ({ params }) => {
				const { serverName } = params;

				const resp = await keyService.handleQuery({
					server_keys: { [serverName]: {} },
				});

				return resp;
			},
			{
				params: t.Object({ serverName: t.String() }),
			},
		);
};
