import { EventID, RoomID, UserID } from '@rocket.chat/federation-room';
import { federationSDK } from '@rocket.chat/federation-sdk';
import { Elysia } from 'elysia';
import { type ErrorResponse, ErrorResponseDto } from '../../dtos';
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
	return app
		.patch(
			'/internal/messages/:messageId',
			async ({
				params,
				body,
				set,
			}): Promise<InternalMessageResponse | ErrorResponse> => {
				const { roomId, message, senderUserId } = body;
				try {
					const eventId = await federationSDK.updateMessage(
						roomId as RoomID,
						message,
						message,
						senderUserId as UserID,
						params.messageId as EventID,
					);
					return {
						event_id: eventId,
						origin_server_ts: Date.now(),
					};
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
				const { roomId, emoji, senderUserId } = body;
				try {
					const eventId = await federationSDK.sendReaction(
						roomId as RoomID,
						params.messageId as EventID,
						emoji,
						senderUserId as UserID,
					);
					return {
						event_id: eventId,
						origin_server_ts: Date.now(),
					};
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
			'/internal/messages/:messageId/reactions',
			async ({
				params,
				body,
				set,
			}): Promise<InternalReactionResponse | ErrorResponse> => {
				const { roomId, emoji, senderUserId } = body;
				try {
					const eventId = await federationSDK.unsetReaction(
						roomId as RoomID,
						params.messageId as EventID,
						emoji,
						senderUserId as UserID,
					);
					return {
						event_id: eventId,
						origin_server_ts: Date.now(),
					};
				} catch (error) {
					set.status = 500;
					return {
						error: `Failed to unset reaction: ${error instanceof Error ? error.message : String(error)}`,
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
					summary: 'Unset a reaction from a message',
					description: 'Remove a reaction from a message',
				},
			},
		)
		.delete(
			'/internal/messages/:messageId',
			async ({
				params,
				body,
			}): Promise<InternalRedactMessageResponse | ErrorResponse> => {
				const { roomId } = body;
				const eventId = await federationSDK.redactMessage(
					roomId as RoomID,
					params.messageId as EventID,
				);

				return {
					event_id: eventId,
					origin_server_ts: Date.now(),
				};
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
