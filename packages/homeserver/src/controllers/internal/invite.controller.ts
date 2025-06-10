import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { type ErrorResponse, ErrorResponseDto, InternalInviteUserBodyDto, type InternalInviteUserResponse, InternalInviteUserResponseDto } from '../../dtos';
import { InviteService } from '../../services/invite.service';

export const internalInvitePlugin = (app: Elysia) => {
	const inviteService = container.resolve(InviteService);
	return app.post('/internal/invites', async ({ body, set }): Promise<InternalInviteUserResponse | ErrorResponse> => {
		const { username, roomId, sender, name } = body;
		try {
			return inviteService.inviteUserToRoom(
				username,
				roomId,
				sender,
				name,
			);
		} catch (error) {
			set.status = 500;
			return {
				error: `Failed to invite user: ${error instanceof Error ? error.message : String(error)}`,
				details: {},
			};
		}
	}, {
		body: InternalInviteUserBodyDto,
		response: {
			200: InternalInviteUserResponseDto,
			400: ErrorResponseDto,
		},
		detail: {
			tags: ['Internal'],
			summary: 'Invite user to room',
			description: 'Invite a user to a room'
		}
	});
};
