import { SendJoinService } from '@hs/federation-sdk';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import {
	ErrorResponseDto,
	SendJoinEventDto,
	SendJoinResponseDto,
} from '../../dtos';

export const sendJoinPlugin = (app: Elysia) => {
	const sendJoinService = container.resolve(SendJoinService);

	return app.put(
		'/_matrix/federation/v2/send_join/:roomId/:eventId',
		async ({
			params,
			body,
			query: _query, // not destructuring this breaks the endpoint
		}) => {
			const { roomId, eventId } = params;

			return sendJoinService.sendJoin(roomId, eventId, body as any);
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
