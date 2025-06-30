import { container } from 'tsyringe';
import type { RouteDefinition } from '../../types/route.types';
import { ErrorResponseDto, InternalInviteUserBodyDto, InternalInviteUserResponseDto } from '../../dtos';
import { InviteService } from '../../services/invite.service';

export const internalInviteRoutes: RouteDefinition[] = [
	{
		method: 'POST',
		path: '/internal/invites',
		handler: async (ctx) => {
			const inviteService = container.resolve(InviteService);
			const { username, roomId, sender, name } = ctx.body;
			try {
				return inviteService.inviteUserToRoom(username, roomId, sender, name);
			} catch (error) {
				ctx.setStatus(500);
				return {
					error: `Failed to invite user: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		},
		validation: {
			body: InternalInviteUserBodyDto,
		},
		responses: {
			200: InternalInviteUserResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Invite user to room',
			description: 'Invite a user to a room',
		},
	},
];
