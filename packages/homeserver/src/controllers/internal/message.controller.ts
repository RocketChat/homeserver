import type { ReactionEvent } from '@hs/core/src/events/m.reaction';
import type { RoomMessageEvent } from '@hs/core/src/events/m.room.message';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { z } from 'zod';
import { MessageService } from '../../services/message.service';
import type { SignedEvent } from '../../signEvent';

const SendMessageSchema = z.object({
	roomId: z.string(),
	targetServer: z.string(),
	message: z.string(),
	senderUserId: z.string(),
});

const UpdateMessageSchema = z.object({
	roomId: z.string(),
	targetServer: z.string(),
	message: z.string(),
	senderUserId: z.string(),
});

const SendReactionSchema = z.object({
	roomId: z.string(),
	targetServer: z.string(),
	eventId: z.string(),
	emoji: z.string(),
	senderUserId: z.string(),
});

type SendReactionResponseDto = SignedEvent<ReactionEvent>;
type SendMessageResponseDto = SignedEvent<RoomMessageEvent>;

export const internalMessagePlugin = (app: Elysia) => {
	const messageService = container.resolve(MessageService);
	return app
		.post('/internal/messages', async ({ body, set }) => {
			const parseResult = SendMessageSchema.safeParse(body);
			if (!parseResult.success) {
				set.status = 400;
				return {
					error: 'Invalid request body',
					details: parseResult.error.flatten(),
				};
			}
			const { roomId, message, senderUserId, targetServer } = parseResult.data;
			return messageService.sendMessage(
				roomId,
				message,
				senderUserId,
				targetServer,
			);
		})
		.patch('/internal/messages/:messageId', async ({ params, body, set }) => {
			const idParse = z.string().safeParse(params.messageId);
			const bodyParse = UpdateMessageSchema.safeParse(body);
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
			const { roomId, message, senderUserId, targetServer } = bodyParse.data;
			return messageService.updateMessage(
				roomId,
				message,
				senderUserId,
				targetServer,
				idParse.data,
			);
		})
		.post(
			'/internal/messages/:messageId/reactions',
			async ({ params, body, set }) => {
				const idParse = z.string().safeParse(params.messageId);
				const bodyParse = SendReactionSchema.safeParse(body);
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
				const { roomId, emoji, senderUserId, targetServer } = bodyParse.data;
				return messageService.sendReaction(
					roomId,
					idParse.data,
					emoji,
					senderUserId,
					targetServer,
				);
			},
		);
};
