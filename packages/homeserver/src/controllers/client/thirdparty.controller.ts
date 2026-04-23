import type { CachedAppService } from '@rocket.chat/federation-sdk';
import { federationSDK } from '@rocket.chat/federation-sdk';
import type { Elysia } from 'elysia';
import { t } from 'elysia';

async function findFirstResult<T>(
	appservices: CachedAppService[],
	protocol: string,
	query: (asId: string, protocol: string) => Promise<T | null>,
): Promise<T | null> {
	for (const as of appservices) {
		if (as.registration.protocols.includes(protocol)) {
			// eslint-disable-next-line no-await-in-loop
			const result = await query(as.registration._id, protocol);
			if (result) return result;
		}
	}
	return null;
}

/**
 * Client-Server API endpoints for third-party protocol lookups.
 */
export const clientThirdPartyPlugin = (_serverName: string) => (app: Elysia) => {
	return app
		.get(
			'/_matrix/client/v3/thirdparty/protocols',
			async () => {
				return federationSDK.getAllProtocols();
			},
			{ detail: { tags: ['Client-Server'], summary: 'List all third-party protocols' } },
		)
		.get(
			'/_matrix/client/v3/thirdparty/protocol/:protocol',
			async ({ params, set }) => {
				const result = await findFirstResult(federationSDK.getAllRegistrations(), params.protocol, (asId, protocol) =>
					federationSDK.queryThirdPartyProtocol(asId, protocol),
				);
				if (result) return result;

				set.status = 404;
				return { errcode: 'M_NOT_FOUND', error: 'Protocol not found' };
			},
			{
				params: t.Object({ protocol: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Get third-party protocol metadata' },
			},
		)
		.get(
			'/_matrix/client/v3/thirdparty/user/:protocol',
			async ({ params, query }) => {
				const fields = { ...query } as Record<string, string>;

				const result = await findFirstResult(federationSDK.getAllRegistrations(), params.protocol, (asId, protocol) =>
					federationSDK.queryThirdPartyUser(asId, protocol, fields),
				);
				return result ?? [];
			},
			{
				params: t.Object({ protocol: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Query third-party users' },
			},
		)
		.get(
			'/_matrix/client/v3/thirdparty/location/:protocol',
			async ({ params, query }) => {
				const fields = { ...query } as Record<string, string>;

				const result = await findFirstResult(federationSDK.getAllRegistrations(), params.protocol, (asId, protocol) =>
					federationSDK.queryThirdPartyLocation(asId, protocol, fields),
				);
				return result ?? [];
			},
			{
				params: t.Object({ protocol: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Query third-party locations' },
			},
		);
};
