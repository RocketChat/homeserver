import { federationSDK } from '@rocket.chat/federation-sdk';
import type { Elysia } from 'elysia';
import { t } from 'elysia';

import { resolveAppServiceAuth } from '../../middlewares/appserviceAuth';

/**
 * POST /_matrix/client/v3/register
 *
 * Supports m.login.application_service auth type for ghost user registration.
 */
export const clientRegisterPlugin = (serverName: string) => (app: Elysia) => {
	return app.post(
		'/_matrix/client/v3/register',
		async ({ body, headers, request, set }) => {
			const authType = body.type || body.auth?.type;
			if (authType !== 'm.login.application_service') {
				set.status = 403;
				return { errcode: 'M_FORBIDDEN', error: 'Only m.login.application_service registration is supported' };
			}

			const auth = resolveAppServiceAuth(request, headers, serverName);
			if (auth.error) {
				set.status = auth.error.status;
				return { errcode: auth.error.errcode, error: auth.error.error };
			}
			if (!auth.appservice) {
				set.status = 401;
				return { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid or missing application service token' };
			}

			const { username } = body;
			if (!username) {
				set.status = 400;
				return { errcode: 'M_MISSING_PARAM', error: 'username is required' };
			}

			const userId = `@${username}:${serverName}`;

			// Check exclusive namespace
			const owningAs = federationSDK.isExclusiveNamespace('users', userId);
			if (owningAs && owningAs.registration._id !== auth.appservice.registration._id) {
				set.status = 400;
				return { errcode: 'M_EXCLUSIVE', error: 'Username is within an exclusive namespace of another appservice' };
			}

			// TODO: Check if user already exists, create user with appserviceId
			return { user_id: userId };
		},
		{
			body: t.Object({
				auth: t.Optional(t.Object({ type: t.String() })),
				type: t.Optional(t.String()),
				username: t.Optional(t.String()),
				password: t.Optional(t.String()),
				device_id: t.Optional(t.String()),
				initial_device_display_name: t.Optional(t.String()),
				inhibit_login: t.Optional(t.Boolean()),
			}),
			detail: { tags: ['Client-Server'], summary: 'Register a new user (appservice)' },
		},
	);
};
