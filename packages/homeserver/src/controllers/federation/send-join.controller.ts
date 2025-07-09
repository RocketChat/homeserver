import { isRoomMemberEvent } from '@hs/core';
import {
	ErrorResponseDto,
	SendJoinEventDto,
	SendJoinParamsDto,
	SendJoinResponseDto,
} from '@hs/federation-sdk';
import { SendJoinService } from '@hs/federation-sdk';
import type { Elysia } from 'elysia';
import { container } from 'tsyringe';

export const sendJoinPlugin = (app: Elysia) => {
	const sendJoinService = container.resolve(SendJoinService);
	return app.put(
		'/_matrix/federation/v2/send_join/:roomId/:stateKey',
		async ({ params, body }) => {
			const event = body;
			const { roomId, stateKey } = params;

			if (!isRoomMemberEvent(event)) {
				throw new Error('Invalid event type. Expected a room member event.');
			}

			return sendJoinService.sendJoin(roomId, stateKey, event);
		},
		{
			params: SendJoinParamsDto,
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
