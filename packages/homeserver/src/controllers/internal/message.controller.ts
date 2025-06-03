import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { z } from 'zod';
import { MessageService } from '../../services/message.service';

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

const RedactMessageSchema = z.object({
	roomId: z.string(),
	targetServer: z.string(),
	reason: z.string().optional(),
	senderUserId: z.string(),
});

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
		)
		.delete('/internal/messages/:messageId', async ({ params, body, set }) => {
			const idParse = z.string().safeParse(params.messageId);
			const bodyParse = RedactMessageSchema.safeParse(body);
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
		});
};
