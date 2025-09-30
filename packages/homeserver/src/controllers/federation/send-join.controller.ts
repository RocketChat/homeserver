import type { EventID, RoomID } from '@rocket.chat/federation-room';
import {
	EventAuthorizationService,
	SendJoinService,
} from '@rocket.chat/federation-sdk';
import { canAccessResource } from '@rocket.chat/homeserver/middlewares/canAccessResource';
import { isAuthenticated } from '@rocket.chat/homeserver/middlewares/isAuthenticated';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import {
	ErrorResponseDto,
	SendJoinEventDto,
	SendJoinResponseDto,
} from '../../dtos';

export const sendJoinPlugin = (app: Elysia) => {
	const sendJoinService = container.resolve(SendJoinService);
	const eventAuthService = container.resolve(EventAuthorizationService);

	return app
		.use(isAuthenticated(eventAuthService))
		.use(canAccessResource(eventAuthService))
		.put(
			'/_matrix/federation/v2/send_join/:roomId/:eventId',
			async ({
				params,
				body,
				query: _query, // not destructuring this breaks the endpoint
			}) => {
				const { roomId, eventId } = params;

			return sendJoinService.sendJoin(
				roomId as RoomID,
				eventId as EventID,
				body as any,
			);
		},
		{
			params: t.Object({
				roomId: t.String(),
				eventId: t.String(),
			}),
			body: SendJoinEventDto,
			response: {
				200: SendJoinResponseDto,
				400: ErrorResponseDto,
			},
			detail: {
				tags: ['Federation'],
				summary: 'Send join',
				description: 'Send a join event to a room',
			},
		},
	);
};
