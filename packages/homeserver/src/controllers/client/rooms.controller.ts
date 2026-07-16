import type { Elysia } from 'elysia';
import { t } from 'elysia';

import { resolveAppServiceAuth } from '../../middlewares/appserviceAuth';

/**
 * Client-Server API endpoints for room operations.
 */
export const clientRoomsPlugin = (serverName: string) => (app: Elysia) => {
	return app
		.post(
			'/_matrix/client/v3/createRoom',
			async ({ body, headers, request, set }) => {
				const auth = resolveAppServiceAuth(request, headers, serverName);
				if (auth.error) {
					set.status = auth.error.status;
					return { errcode: auth.error.errcode, error: auth.error.error };
				}
				if (!auth.appservice) {
					set.status = 401;
					return { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid or missing application service token' };
				}

				// TODO: Create room via federation SDK as auth.actingUserId
				return { room_id: `!stub:${serverName}` };
			},
			{
				body: t.Object({
					room_alias_name: t.Optional(t.String()),
					name: t.Optional(t.String()),
					topic: t.Optional(t.String()),
					visibility: t.Optional(t.Union([t.Literal('public'), t.Literal('private')])),
					invite: t.Optional(t.Array(t.String())),
					preset: t.Optional(t.Union([t.Literal('private_chat'), t.Literal('public_chat'), t.Literal('trusted_private_chat')])),
					is_direct: t.Optional(t.Boolean()),
					creation_content: t.Optional(t.Record(t.String(), t.Unknown())),
					initial_state: t.Optional(
						t.Array(t.Object({ type: t.String(), state_key: t.Optional(t.String()), content: t.Record(t.String(), t.Unknown()) })),
					),
					power_level_content_override: t.Optional(t.Record(t.String(), t.Unknown())),
				}),
				detail: { tags: ['Client-Server'], summary: 'Create a room' },
			},
		)
		.post(
			'/_matrix/client/v3/join/:roomIdOrAlias',
			async ({ params, headers, request, set }) => {
				const auth = resolveAppServiceAuth(request, headers, serverName);
				if (auth.error) {
					set.status = auth.error.status;
					return { errcode: auth.error.errcode, error: auth.error.error };
				}
				if (!auth.appservice) {
					set.status = 401;
					return { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid or missing application service token' };
				}

				// TODO: Join room via federation SDK as auth.actingUserId
				return { room_id: params.roomIdOrAlias.startsWith('!') ? params.roomIdOrAlias : `!stub:${serverName}` };
			},
			{
				params: t.Object({ roomIdOrAlias: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Join a room' },
			},
		)
		.post(
			'/_matrix/client/v3/rooms/:roomId/leave',
			async ({ params, headers, request, set }) => {
				const auth = resolveAppServiceAuth(request, headers, serverName);
				if (auth.error) {
					set.status = auth.error.status;
					return { errcode: auth.error.errcode, error: auth.error.error };
				}
				if (!auth.appservice) {
					set.status = 401;
					return { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid or missing application service token' };
				}

				// TODO: Leave room
				return {};
			},
			{
				params: t.Object({ roomId: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Leave a room' },
			},
		)
		.post(
			'/_matrix/client/v3/rooms/:roomId/invite',
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

				// TODO: Invite user
				return {};
			},
			{
				params: t.Object({ roomId: t.String() }),
				body: t.Object({ user_id: t.String(), reason: t.Optional(t.String()) }),
				detail: { tags: ['Client-Server'], summary: 'Invite a user to a room' },
			},
		);
};
