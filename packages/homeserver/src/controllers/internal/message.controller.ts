import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import {
	type ErrorResponse,
	type InternalMessageResponse,
	type InternalReactionResponse,
	type InternalRedactMessageResponse,
	ErrorResponseDto,
	InternalMessageResponseDto,
	InternalReactionResponseDto,
	InternalRedactMessageBodyDto,
	InternalRedactMessageParamsDto,
	InternalRedactMessageResponseDto,
	InternalSendMessageBodyDto,
	InternalSendReactionBodyDto,
	InternalSendReactionParamsDto,
	InternalUpdateMessageBodyDto,
	InternalUpdateMessageParamsDto
} from '../../dtos';
import { MessageService } from '../../services/message.service';

export const internalMessagePlugin = (app: Elysia) => {
	const messageService = container.resolve(MessageService);
	return app
		.post('/internal/messages', async ({ body, set }): Promise<InternalMessageResponse | ErrorResponse> => {
			const { roomId, message, senderUserId, targetServer } = body;
			try {
				return await messageService.sendMessage(
					roomId,
					message,
					senderUserId,
					targetServer,
				);
			} catch (error) {
				set.status = 500;
				return {
					error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		}, {
			body: InternalSendMessageBodyDto,
			response: {
				200: InternalMessageResponseDto,
				500: ErrorResponseDto
			},
			detail: {
				tags: ['Internal'],
				summary: 'Send a message to a room',
				description: 'Send a text message to a Matrix room'
			}
		})
		.patch('/internal/messages/:messageId', async ({ params, body, set }): Promise<InternalMessageResponse | ErrorResponse> => {
			const { roomId, message, senderUserId, targetServer } = body;
			try {
				return await messageService.updateMessage(
					roomId,
					message,
					senderUserId,
					targetServer,
					params.messageId,
				);
			} catch (error) {
				set.status = 500;
				return {
					error: `Failed to update message: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		}, {
			params: InternalUpdateMessageParamsDto,
			body: InternalUpdateMessageBodyDto,
			response: {
				200: InternalMessageResponseDto,
				500: ErrorResponseDto
			},
			detail: {
				tags: ['Internal'],
				summary: 'Update a message',
				description: 'Update the content of an existing message'
			}
		})
		.post(
			'/internal/messages/:messageId/reactions',
			async ({ params, body, set }): Promise<InternalReactionResponse | ErrorResponse> => {
				const { roomId, emoji, senderUserId, targetServer } = body;
				try {
					return await messageService.sendReaction(
						roomId,
						params.messageId,
						emoji,
						senderUserId,
						targetServer,
					);
				} catch (error) {
					set.status = 500;
					return {
						error: `Failed to send reaction: ${error instanceof Error ? error.message : String(error)}`,
						details: {},
					};
				}
			},
			{
				params: InternalSendReactionParamsDto,
				body: InternalSendReactionBodyDto,
				response: {
					200: InternalReactionResponseDto,
					500: ErrorResponseDto
				},
				detail: {
					tags: ['Internal'],
					summary: 'Send a reaction to a message',
					description: 'Send a reaction to a message'
				}
			}
		)
		.delete('/internal/messages/:messageId', async ({ params, body, set }): Promise<InternalRedactMessageResponse | ErrorResponse> => {
			const idParse = InternalRedactMessageParamsDto.safeParse(params);
			const bodyParse = InternalRedactMessageBodyDto.safeParse(body);
			if (!idParse.success || !bodyParse.success) {
				set.status = 400;
				return {
					error: 'Invalid request',
					details: {
						id: idParse.error?.flatten(),
						body: bodyParse.error?.flatten(),
					},
				};
			}
			const { roomId, reason, senderUserId, targetServer } = bodyParse.data;
			return messageService.redactMessage(
				roomId,
				idParse.data,
				reason,
				senderUserId,
				targetServer,
			);
		}, {
			params: InternalRedactMessageParamsDto,
			body: InternalRedactMessageBodyDto,
			response: {
				200: InternalRedactMessageResponseDto,
				500: ErrorResponseDto
			},
			detail: {
				tags: ['Internal'],
				summary: 'Redact a message',
				description: 'Redact a message'
			}
		});
};
