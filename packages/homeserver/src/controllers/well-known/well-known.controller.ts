import { federationSDK } from '@rocket.chat/federation-sdk';
import { Elysia } from 'elysia';
import { WellKnownServerResponseDto } from '../../dtos';

export const wellKnownPlugin = (app: Elysia) => {
	return app.get(
		'/.well-known/matrix/server',
		({ set }) => {
			const responseData = federationSDK.getWellKnownHostData();
			const etag = new Bun.CryptoHasher('md5')
				.update(JSON.stringify(responseData))
				.digest('hex');
			set.headers.ETag = etag;
			set.headers['Content-Type'] = 'application/json';
			return responseData;
		},
		{
			response: {
				200: WellKnownServerResponseDto,
			},
			detail: {
				tags: ['Well-Known'],
				summary: 'Get well-known host data',
				description: 'Get the well-known host data',
			},
		},
	);
};
