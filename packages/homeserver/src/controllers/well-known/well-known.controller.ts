import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { WellKnownService } from '../../services/well-known.service';

export const wellKnownPlugin = (app: Elysia) => {
	const wellKnownService = container.resolve(WellKnownService);
	return app.get('/.well-known/matrix/server', ({ set }) => {
		const responseData = wellKnownService.getWellKnownHostData();
		const etag = new Bun.CryptoHasher('md5')
			.update(JSON.stringify(responseData))
			.digest('hex');
		set.headers.ETag = etag;
		set.headers['Content-Type'] = 'application/json';
		return responseData;
	});
};
