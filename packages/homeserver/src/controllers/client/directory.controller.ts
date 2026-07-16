import type { Elysia } from 'elysia';
import { t } from 'elysia';

import { resolveAppServiceAuth } from '../../middlewares/appserviceAuth';

/**
 * Client-Server API endpoints for room directory management.
 */
export const clientDirectoryPlugin = (serverName: string) => (app: Elysia) => {
	return app.put(
		'/_matrix/client/v3/directory/room/:roomAlias',
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

			// TODO: Create room alias -> room_id mapping
			return {};
		},
		{
			params: t.Object({ roomAlias: t.String() }),
			body: t.Object({ room_id: t.String() }),
			detail: { tags: ['Client-Server'], summary: 'Create a room alias' },
		},
	);
};
