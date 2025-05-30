import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import type { ProcessInviteEvent } from '../../services/invite.service';
import { InviteService } from '../../services/invite.service';

export const invitePlugin = (app: Elysia) => {
	const inviteService = container.resolve(InviteService);
	return app.put(
		'/_matrix/federation/v2/invite/:roomId/:eventId',
		async ({ body, params }) => {
			const { roomId, eventId } = params as { roomId: string; eventId: string };
			return inviteService.processInvite(
				body as ProcessInviteEvent,
				roomId,
				eventId,
			);
		},
	);
};
