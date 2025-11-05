import { EventID, RoomID } from '@rocket.chat/federation-room';
import { NotAllowedError, federationSDK } from '@rocket.chat/federation-sdk';
import { isAuthenticatedMiddleware } from '@rocket.chat/homeserver/middlewares/isAuthenticated';
import { Elysia, t } from 'elysia';
import {
	FederationErrorResponseDto,
	ProcessInviteParamsDto,
	ProcessInviteResponseDto,
	RoomVersionDto,
} from '../../dtos';

export const invitePlugin = (app: Elysia) => {
	return app.use(isAuthenticatedMiddleware()).put(
		'/_matrix/federation/v2/invite/:roomId/:eventId',
		async ({ body, set, params: { roomId, eventId }, authenticatedServer }) => {
			if (!authenticatedServer) {
				throw new Error('Missing authenticated server from request');
			}

			try {
				return await federationSDK.processInvite(
					body.event,
					roomId as RoomID,
					eventId as EventID,
					body.room_version,
					authenticatedServer,
					body.invite_room_state,
				);
			} catch (error) {
				if (error instanceof NotAllowedError) {
					set.status = 403;
					return {
						errcode: 'M_FORBIDDEN',
						error:
							'This server does not allow joining this type of room based on federation settings.',
					};
				}

				set.status = 500;
				return {
					errcode: 'M_UNKNOWN',
					error:
						error instanceof Error
							? error.message
							: 'Internal server error while processing request',
				};
			}
		},
		{
			params: ProcessInviteParamsDto,
			body: t.Object({
				event: t.Any(),
				room_version: RoomVersionDto,
				invite_room_state: t.Any(),
			}),
			response: {
				200: ProcessInviteResponseDto,
				403: FederationErrorResponseDto,
				500: FederationErrorResponseDto,
			},
			detail: {
				tags: ['Federation'],
				summary: 'Process room invite',
				description: 'Process an invite event from another Matrix server',
			},
		},
	);
};
