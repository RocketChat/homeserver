import type { UserID } from '@rocket.chat/federation-room';
import { federationSDK } from '@rocket.chat/federation-sdk';
import type { Elysia } from 'elysia';
import { t } from 'elysia';
import { container } from 'tsyringe';

import { type ErrorResponse, ErrorResponseDto } from '../../dtos';

// DTOs for direct message operations
export const InternalCreateDirectMessageBodyDto = t.Object({
	senderUserId: t.String(),
	targetUserId: t.String(),
});

export const InternalDirectMessageResponseDto = t.Object({
	roomId: t.String(),
});

export type InternalCreateDirectMessageBody = typeof InternalCreateDirectMessageBodyDto.static;
export type InternalDirectMessageResponse = typeof InternalDirectMessageResponseDto.static;

export const internalDirectMessagePlugin = (app: Elysia) => {
	return app.post(
		'/internal/direct-messages/create',
		async ({ body, set }): Promise<InternalDirectMessageResponse | ErrorResponse> => {
			const { senderUserId, targetUserId } = body;
			try {
				const roomId = await federationSDK.createDirectMessageRoom(senderUserId as UserID, targetUserId as UserID);
				return {
					roomId,
				};
			} catch (error) {
				set.status = 500;
				return {
					error: `Failed to create direct message room: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		},
		{
			body: InternalCreateDirectMessageBodyDto,
			response: {
				200: InternalDirectMessageResponseDto,
				500: ErrorResponseDto,
			},
			detail: {
				tags: ['Internal', 'Direct Messages'],
				summary: 'Create direct message room',
				description:
					'Create a new direct message room between two users or return existing room ID. Use existing message endpoints to send messages to the returned room.',
			},
		},
	);
};
