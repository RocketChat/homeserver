import { container } from 'tsyringe';
import type { RouteDefinition } from '../../types/route.types';
import {
	// type ErrorResponse,
	// type InternalMessageResponse,
	// type InternalReactionResponse,
	// type InternalRedactMessageResponse,
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
	InternalUpdateMessageParamsDto,
} from '../../dtos';
import { MessageService } from '../../services/message.service';

export const messageRoutes: RouteDefinition[] = [
	{
		method: 'POST',
		path: '/internal/messages',
		handler: async (ctx) => {
			const messageService = container.resolve(MessageService);
			const { roomId, message, senderUserId, targetServer } = ctx.body;
			try {
				return await messageService.sendMessage(roomId, message, senderUserId, targetServer);
			} catch (error) {
				ctx.setStatus(500);
				return {
					error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		},
		validation: {
			body: InternalSendMessageBodyDto,
		},
		responses: {
			200: InternalMessageResponseDto,
			500: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Send a message to a room',
			description: 'Send a text message to a Matrix room',
		},
	},
	{
		method: 'PATCH',
		path: '/internal/messages/:messageId',
		handler: async (ctx) => {
			const messageService = container.resolve(MessageService);
			const { roomId, message, senderUserId, targetServer } = ctx.body;
			try {
				return await messageService.updateMessage(roomId, message, senderUserId, targetServer, ctx.params.messageId);
			} catch (error) {
				ctx.setStatus(500);
				return {
					error: `Failed to update message: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		},
		validation: {
			params: InternalUpdateMessageParamsDto,
			body: InternalUpdateMessageBodyDto,
		},
		responses: {
			200: InternalMessageResponseDto,
			500: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Update a message',
			description: 'Update the content of an existing message',
		},
	},
	{
		method: 'POST',
		path: '/internal/messages/:messageId/reactions',
		handler: async (ctx) => {
			const messageService = container.resolve(MessageService);
			const { roomId, emoji, senderUserId, targetServer } = ctx.body;
			try {
				return await messageService.sendReaction(roomId, ctx.params.messageId, emoji, senderUserId, targetServer);
			} catch (error) {
				ctx.setStatus(500);
				return {
					error: `Failed to send reaction: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		},
		validation: {
			params: InternalSendReactionParamsDto,
			body: InternalSendReactionBodyDto,
		},
		responses: {
			200: InternalReactionResponseDto,
			500: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Send a reaction to a message',
			description: 'Send a reaction to a message',
		},
	},
	{
		method: 'DELETE',
		path: '/internal/messages/:messageId',
		handler: async (ctx) => {
			const messageService = container.resolve(MessageService);
			const { roomId, reason, senderUserId, targetServer } = ctx.body;
			return messageService.redactMessage(roomId, ctx.params.messageId, reason, senderUserId, targetServer);
		},
		validation: {
			params: InternalRedactMessageParamsDto,
			body: InternalRedactMessageBodyDto,
		},
		responses: {
			200: InternalRedactMessageResponseDto,
			500: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Redact a message',
			description: 'Redact a message',
		},
	},
];
