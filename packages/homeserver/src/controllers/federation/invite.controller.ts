import { EventID, RoomID } from '@rocket.chat/federation-room';
import {
	EventAuthorizationService,
	InviteService,
} from '@rocket.chat/federation-sdk';
import { isAuthenticatedMiddleware } from '@rocket.chat/homeserver/middlewares/isAuthenticated';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import { ProcessInviteParamsDto, RoomVersionDto } from '../../dtos';

export const invitePlugin = (app: Elysia) => {
	const inviteService = container.resolve(InviteService);
	const eventAuthService = container.resolve(EventAuthorizationService);

	return app.use(isAuthenticatedMiddleware(eventAuthService)).put(
		'/_matrix/federation/v2/invite/:roomId/:eventId',
		async ({ body, params: { roomId, eventId }, authenticatedServer }) => {
			if (!authenticatedServer) {
				throw new Error('Missing authenticated server from request');
			}

			return inviteService.processInvite(
				body.event,
				roomId as RoomID,
				eventId as EventID,
				body.room_version,
				authenticatedServer,
			);
		},
		{
			params: ProcessInviteParamsDto,
			body: t.Object({
				event: t.Any(),
				room_version: RoomVersionDto,
				invite_room_state: t.Any(),
			}),
			detail: {
				tags: ['Federation'],
				summary: 'Process room invite',
				description: 'Process an invite event from another Matrix server',
			},
		},
	);
};
