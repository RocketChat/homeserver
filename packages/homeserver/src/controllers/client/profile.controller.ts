import type { Elysia } from 'elysia';
import { t } from 'elysia';

import { resolveAppServiceAuth } from '../../middlewares/appserviceAuth';

/**
 * Client-Server API endpoints for user profiles.
 */
export const clientProfilePlugin = (serverName: string) => (app: Elysia) => {
	return app
		.put(
			'/_matrix/client/v3/profile/:userId/displayname',
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

				// TODO: Update user display name
				return {};
			},
			{
				params: t.Object({ userId: t.String() }),
				body: t.Object({ displayname: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Set display name' },
			},
		)
		.put(
			'/_matrix/client/v3/profile/:userId/avatar_url',
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

				// TODO: Update user avatar URL
				return {};
			},
			{
				params: t.Object({ userId: t.String() }),
				body: t.Object({ avatar_url: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Set avatar URL' },
			},
		)
		.get(
			'/_matrix/client/v3/profile/:userId',
			async ({ params }) => {
				// TODO: Look up user profile from the database
				return { displayname: params.userId };
			},
			{
				params: t.Object({ userId: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Get user profile' },
			},
		)
		.get(
			'/_matrix/client/v3/account/whoami',
			async ({ headers, request, set }) => {
				const auth = resolveAppServiceAuth(request, headers, serverName);
				if (auth.error) {
					set.status = auth.error.status;
					return { errcode: auth.error.errcode, error: auth.error.error };
				}
				if (!auth.appservice) {
					set.status = 401;
					return { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid or missing application service token' };
				}

				return { user_id: auth.actingUserId, is_guest: false };
			},
			{
				detail: { tags: ['Client-Server'], summary: 'Who am I' },
			},
		);
};
