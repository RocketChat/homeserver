import { type ErrorResponse, ErrorResponseDto } from '@hs/federation-sdk';
import { MessageService } from '@hs/federation-sdk';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import {
	type InternalMessageResponse,
	InternalMessageResponseDto,
	type InternalReactionResponse,
	InternalReactionResponseDto,
	InternalRedactMessageBodyDto,
	InternalRedactMessageParamsDto,
	type InternalRedactMessageResponse,
	InternalRedactMessageResponseDto,
	InternalSendMessageBodyDto,
	InternalSendReactionBodyDto,
	InternalSendReactionParamsDto,
	InternalUpdateMessageBodyDto,
	InternalUpdateMessageParamsDto,
} from '../../dtos';

export const internalMessagePlugin = (app: Elysia) => {
	const messageService = container.resolve(MessageService);
	return app
		.post(
			'/internal/messages',
			async ({
				body,
				set,
			}): Promise<InternalMessageResponse | ErrorResponse> => {
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
			},
			{
				body: InternalSendMessageBodyDto,
				response: {
					200: InternalMessageResponseDto,
					500: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Send a message to a room',
					description: 'Send a text message to a Matrix room',
				},
			},
		)
		.patch(
			'/internal/messages/:messageId',
			async ({
				params,
				body,
				set,
			}): Promise<InternalMessageResponse | ErrorResponse> => {
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
			},
			{
				params: InternalUpdateMessageParamsDto,
				body: InternalUpdateMessageBodyDto,
				response: {
					200: InternalMessageResponseDto,
					500: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Update a message',
					description: 'Update the content of an existing message',
				},
			},
		)
		.post(
			'/internal/messages/:messageId/reactions',
			async ({
				params,
				body,
				set,
			}): Promise<InternalReactionResponse | ErrorResponse> => {
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
					500: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Send a reaction to a message',
					description: 'Send a reaction to a message',
				},
			},
		)
		.delete(
			'/internal/messages/:messageId',
			async ({
				params,
				body,
			}): Promise<InternalRedactMessageResponse | ErrorResponse> => {
				const { roomId, reason, senderUserId, targetServer } = body;
				return messageService.redactMessage(
					roomId,
					params.messageId,
					reason,
					senderUserId,
					targetServer,
				);
			},
			{
				params: InternalRedactMessageParamsDto,
				body: InternalRedactMessageBodyDto,
				response: {
					200: InternalRedactMessageResponseDto,
					500: ErrorResponseDto,
				},
				detail: {
					tags: ['Internal'],
					summary: 'Redact a message',
					description: 'Redact a message',
				},
			},
		);
};
