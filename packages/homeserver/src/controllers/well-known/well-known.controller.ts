import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { WellKnownServerResponseDto } from '@hs/federation-sdk';
import { WellKnownService } from '@hs/federation-sdk';

export const wellKnownPlugin = (app: Elysia) => {
	const wellKnownService = container.resolve(WellKnownService);
	return app.get(
		'/.well-known/matrix/server',
		({ set }) => {
			const responseData = wellKnownService.getWellKnownHostData();
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
