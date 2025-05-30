import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { InviteService } from '../../services/invite.service';

export const internalInvitePlugin = (app: Elysia) => {
	const inviteService = container.resolve(InviteService);
	return app.post('/internal/invites', async ({ body, set }) => {
		const { username, roomId, sender, name } = body as {
			username: string;
			roomId?: string;
			sender?: string;
			name: string;
		};
		try {
			return await inviteService.inviteUserToRoom(
				username,
				roomId,
				sender,
				name,
			);
		} catch (error) {
			set.status = 500;
			return {
				error: `Failed to invite user: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	});
};
