import type { EventID, RoomID } from '@rocket.chat/federation-room';
import { federationSDK } from '@rocket.chat/federation-sdk';
import { canAccessResourceMiddleware } from '@rocket.chat/homeserver/middlewares/canAccessResource';
import type { Elysia } from 'elysia';
import { t } from 'elysia';

import { ErrorResponseDto, SendJoinEventDto, SendJoinResponseDto } from '../../dtos';

export const sendJoinPlugin = (app: Elysia) => {
	return app.use(canAccessResourceMiddleware('room')).put(
		'/_matrix/federation/v2/send_join/:roomId/:eventId',
		async ({
			params,
			body,
			query: _query, // not destructuring this breaks the endpoint
		}) => {
			const { roomId, eventId } = params;

			return federationSDK.sendJoin(roomId as RoomID, eventId as EventID, body as any);
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
