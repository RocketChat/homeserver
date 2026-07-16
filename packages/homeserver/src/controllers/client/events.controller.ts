import type { Elysia } from 'elysia';
import { t } from 'elysia';

import { resolveAppServiceAuth } from '../../middlewares/appserviceAuth';

/**
 * Client-Server API endpoints for sending events.
 * Used by bridges to send messages and state events as ghost users.
 */
export const clientEventsPlugin = (serverName: string) => (app: Elysia) => {
	return app
		.put(
			'/_matrix/client/v3/rooms/:roomId/send/:eventType/:txnId',
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

				const { roomId, eventType, txnId } = params;

				// TODO: Create the event using the federation SDK
				// - Use auth.actingUserId as the sender
				// - Use auth.timestampOverride for origin_server_ts if provided
				// - Deduplicate by txnId per sender

				return { event_id: `$stub_${txnId}` };
			},
			{
				params: t.Object({ roomId: t.String(), eventType: t.String(), txnId: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Send a message event' },
			},
		)
		.put(
			'/_matrix/client/v3/rooms/:roomId/state/:eventType/:stateKey',
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

				// TODO: Create the state event using the federation SDK

				return { event_id: `$stub_state_${params.eventType}_${params.stateKey}` };
			},
			{
				params: t.Object({ roomId: t.String(), eventType: t.String(), stateKey: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Send a state event' },
			},
		)
		.put(
			'/_matrix/client/v3/rooms/:roomId/state/:eventType',
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

				return { event_id: `$stub_state_${params.eventType}` };
			},
			{
				params: t.Object({ roomId: t.String(), eventType: t.String() }),
				detail: { tags: ['Client-Server'], summary: 'Send a state event (empty state key)' },
			},
		);
};
