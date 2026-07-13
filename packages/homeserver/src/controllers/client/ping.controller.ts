import { federationSDK } from '@rocket.chat/federation-sdk';
import type { Elysia } from 'elysia';
import { t } from 'elysia';

import { resolveAppServiceAuth } from '../../middlewares/appserviceAuth';

/**
 * MSC2659 appservice ping. A bridge calls this when it boots; the homeserver
 * pings the bridge back and, on success, force-retries its backlog so recovery
 * doesn't wait out the recoverer's backoff.
 */
export const clientAppservicePingPlugin = (serverName: string) => (app: Elysia) => {
	return app.post(
		'/_matrix/client/v1/appservice/:appserviceId/ping',
		async ({ params, body, headers, request, set }) => {
			const auth = resolveAppServiceAuth(request, headers, serverName);
			if (auth.error) {
				set.status = auth.error.status;
				return { errcode: auth.error.errcode, error: auth.error.error };
			}
			if (!auth.appservice) {
				set.status = 401;
				return { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid or missing application service token' };
			}
			if (auth.appservice.registration._id !== params.appserviceId) {
				set.status = 403;
				return { errcode: 'M_FORBIDDEN', error: 'Cannot ping a different appservice' };
			}

			const result = await federationSDK.pingAppService(params.appserviceId, body?.transaction_id);

			if ('errcode' in result) {
				if (result.errcode === 'M_URL_NOT_SET') {
					set.status = 400;
				} else if (result.errcode === 'M_CONNECTION_TIMEOUT') {
					set.status = 504;
				} else {
					set.status = 502;
				}
				return result;
			}

			await federationSDK.forceRetryAppService(params.appserviceId);

			return result;
		},
		{
			params: t.Object({ appserviceId: t.String() }),
			body: t.Optional(t.Object({ transaction_id: t.Optional(t.String()) })),
			detail: { tags: ['Client-Server'], summary: 'Ping an appservice (MSC2659)' },
		},
	);
};
