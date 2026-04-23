import type { AppServiceRegistration } from '@rocket.chat/federation-sdk';
import { federationSDK } from '@rocket.chat/federation-sdk';
import type { Elysia } from 'elysia';
import { t } from 'elysia';

/**
 * Admin API for managing Application Service registrations.
 * Provides a REST alternative to YAML registration files.
 *
 * All endpoints are under /admin/appservices and should be protected
 * by admin authentication.
 */
export const adminAppServicePlugin = (app: Elysia) => {
	return (
		app
			/**
			 * POST /admin/appservices - Register a new appservice
			 */
			.post(
				'/admin/appservices',
				async ({ body, set }) => {
					const now = new Date();
					const registration: AppServiceRegistration = {
						_id: body.id,
						url: body.url ?? null,
						asToken: body.as_token,
						hsToken: body.hs_token,
						senderLocalpart: body.sender_localpart,
						namespaces: {
							users: (body.namespaces?.users ?? []).map((ns) => ({
								regex: ns.regex,
								exclusive: ns.exclusive ?? false,
							})),
							aliases: (body.namespaces?.aliases ?? []).map((ns) => ({
								regex: ns.regex,
								exclusive: ns.exclusive ?? false,
							})),
							rooms: (body.namespaces?.rooms ?? []).map((ns) => ({
								regex: ns.regex,
								exclusive: ns.exclusive ?? false,
							})),
						},
						protocols: body.protocols ?? [],
						rateLimited: body.rate_limited ?? true,
						receiveEphemeral: body.receive_ephemeral ?? false,
						createdAt: now,
						updatedAt: now,
					};

					try {
						await federationSDK.registerAppService(registration);
						set.status = 201;
						return { id: registration._id, status: 'registered' };
					} catch (err) {
						set.status = 400;
						return {
							errcode: 'M_INVALID_PARAM',
							error: err instanceof Error ? err.message : 'Registration failed',
						};
					}
				},
				{
					body: t.Object({
						id: t.String({ minLength: 1 }),
						url: t.Optional(t.Nullable(t.String())),
						as_token: t.String({ minLength: 1 }),
						hs_token: t.String({ minLength: 1 }),
						sender_localpart: t.String({ minLength: 1 }),
						namespaces: t.Optional(
							t.Object({
								users: t.Optional(
									t.Array(
										t.Object({
											regex: t.String(),
											exclusive: t.Optional(t.Boolean()),
										}),
									),
								),
								aliases: t.Optional(
									t.Array(
										t.Object({
											regex: t.String(),
											exclusive: t.Optional(t.Boolean()),
										}),
									),
								),
								rooms: t.Optional(
									t.Array(
										t.Object({
											regex: t.String(),
											exclusive: t.Optional(t.Boolean()),
										}),
									),
								),
							}),
						),
						protocols: t.Optional(t.Array(t.String())),
						rate_limited: t.Optional(t.Boolean()),
						receive_ephemeral: t.Optional(t.Boolean()),
					}),
					detail: {
						tags: ['Admin'],
						summary: 'Register a new appservice',
						description: 'Register a bridge/appservice dynamically without YAML files',
					},
				},
			)
			/**
			 * GET /admin/appservices - List all registered appservices
			 */
			.get(
				'/admin/appservices',
				async () => {
					const allServices = federationSDK.getAllRegistrations();

					const result = await Promise.all(
						allServices.map(async (as) => {
							const state = await federationSDK.getAppServiceState(as.registration._id);
							return {
								id: as.registration._id,
								url: as.registration.url,
								sender_localpart: as.registration.senderLocalpart,
								protocols: as.registration.protocols,
								namespaces: as.registration.namespaces,
								state: state?.state ?? 'unknown',
								last_txn_id: state?.lastTxnId ?? 0,
							};
						}),
					);

					return { appservices: result };
				},
				{
					detail: {
						tags: ['Admin'],
						summary: 'List all appservices',
					},
				},
			)
			/**
			 * GET /admin/appservices/:id - Get appservice details
			 */
			.get(
				'/admin/appservices/:id',
				async ({ params, set }) => {
					const as = federationSDK.getRegistrationById(params.id);
					if (!as) {
						set.status = 404;
						return { errcode: 'M_NOT_FOUND', error: 'Appservice not found' };
					}

					const state = await federationSDK.getAppServiceState(params.id);

					return {
						id: as.registration._id,
						url: as.registration.url,
						sender_localpart: as.registration.senderLocalpart,
						protocols: as.registration.protocols,
						namespaces: as.registration.namespaces,
						rate_limited: as.registration.rateLimited,
						receive_ephemeral: as.registration.receiveEphemeral,
						state: state?.state ?? 'unknown',
						last_txn_id: state?.lastTxnId ?? 0,
						last_error: state?.lastError,
						last_error_at: state?.lastErrorAt,
					};
				},
				{
					params: t.Object({ id: t.String() }),
					detail: {
						tags: ['Admin'],
						summary: 'Get appservice details',
					},
				},
			)
			/**
			 * PUT /admin/appservices/:id - Update appservice registration
			 */
			.put(
				'/admin/appservices/:id',
				async ({ params, body, set }) => {
					const existing = federationSDK.getRegistrationById(params.id);
					if (!existing) {
						set.status = 404;
						return { errcode: 'M_NOT_FOUND', error: 'Appservice not found' };
					}

					const updated: AppServiceRegistration = {
						...existing.registration,
						...(body.url !== undefined && { url: body.url }),
						...(body.as_token && { asToken: body.as_token }),
						...(body.hs_token && { hsToken: body.hs_token }),
						...(body.sender_localpart && { senderLocalpart: body.sender_localpart }),
						...(body.protocols && { protocols: body.protocols }),
						...(body.rate_limited !== undefined && { rateLimited: body.rate_limited }),
						...(body.receive_ephemeral !== undefined && { receiveEphemeral: body.receive_ephemeral }),
						...(body.namespaces && {
							namespaces: {
								users: (body.namespaces.users ?? existing.registration.namespaces.users).map((ns) => ({
									regex: ns.regex,
									exclusive: ns.exclusive ?? false,
								})),
								aliases: (body.namespaces.aliases ?? existing.registration.namespaces.aliases).map((ns) => ({
									regex: ns.regex,
									exclusive: ns.exclusive ?? false,
								})),
								rooms: (body.namespaces.rooms ?? existing.registration.namespaces.rooms).map((ns) => ({
									regex: ns.regex,
									exclusive: ns.exclusive ?? false,
								})),
							},
						}),
						updatedAt: new Date(),
					};

					try {
						await federationSDK.registerAppService(updated);
						return { id: params.id, status: 'updated' };
					} catch (err) {
						set.status = 400;
						return {
							errcode: 'M_INVALID_PARAM',
							error: err instanceof Error ? err.message : 'Update failed',
						};
					}
				},
				{
					params: t.Object({ id: t.String() }),
					body: t.Object({
						url: t.Optional(t.Nullable(t.String())),
						as_token: t.Optional(t.String()),
						hs_token: t.Optional(t.String()),
						sender_localpart: t.Optional(t.String()),
						namespaces: t.Optional(
							t.Object({
								users: t.Optional(t.Array(t.Object({ regex: t.String(), exclusive: t.Optional(t.Boolean()) }))),
								aliases: t.Optional(t.Array(t.Object({ regex: t.String(), exclusive: t.Optional(t.Boolean()) }))),
								rooms: t.Optional(t.Array(t.Object({ regex: t.String(), exclusive: t.Optional(t.Boolean()) }))),
							}),
						),
						protocols: t.Optional(t.Array(t.String())),
						rate_limited: t.Optional(t.Boolean()),
						receive_ephemeral: t.Optional(t.Boolean()),
					}),
					detail: {
						tags: ['Admin'],
						summary: 'Update appservice registration',
					},
				},
			)
			/**
			 * DELETE /admin/appservices/:id - Remove appservice
			 */
			.delete(
				'/admin/appservices/:id',
				async ({ params, set }) => {
					const removed = await federationSDK.unregisterAppService(params.id);

					if (!removed) {
						set.status = 404;
						return { errcode: 'M_NOT_FOUND', error: 'Appservice not found' };
					}

					return { id: params.id, status: 'removed' };
				},
				{
					params: t.Object({ id: t.String() }),
					detail: {
						tags: ['Admin'],
						summary: 'Remove appservice',
					},
				},
			)
			/**
			 * POST /admin/appservices/:id/ping - Admin-initiated ping
			 */
			.post(
				'/admin/appservices/:id/ping',
				async ({ params, set }) => {
					const result = await federationSDK.pingAppService(params.id);

					if ('errcode' in result) {
						if (result.errcode === 'M_NOT_FOUND') {
							set.status = 404;
						} else if (result.errcode === 'M_URL_NOT_SET') {
							set.status = 400;
						} else {
							set.status = 502;
						}
						return result;
					}

					return result;
				},
				{
					params: t.Object({ id: t.String() }),
					detail: {
						tags: ['Admin'],
						summary: 'Ping an appservice',
						description: 'Admin-initiated ping to check appservice connectivity',
					},
				},
			)
	);
};
