import { z } from 'zod';
import { RoomIdDto, ServerNameDto, UsernameDto } from '../common/validation.dto';

export const InternalSendMessageBodyDto = z.object({
	roomId: RoomIdDto,
	targetServer: ServerNameDto,
	message: z.string()
		.min(1)
		.describe('Message content'),
	senderUserId: UsernameDto,
});

export const InternalUpdateMessageParamsDto = z.object({
	messageId: z.string().describe('Message ID to update'),
});

export const InternalUpdateMessageBodyDto = z.object({
	roomId: RoomIdDto,
	targetServer: ServerNameDto,
	message: z.string()
		.min(1)
		.describe('Updated message content'),
	senderUserId: UsernameDto,
});

export const InternalSendReactionParamsDto = z.object({
	messageId: z.string().describe('Message ID to react to'),
});

export const InternalSendReactionBodyDto = z.object({
	roomId: RoomIdDto,
	targetServer: ServerNameDto,
	eventId: z.string().describe('Event ID to react to'),
	emoji: z.string()
		.min(1)
		.describe('Emoji reaction'),
	senderUserId: UsernameDto,
});

export const InternalMessageResponseDto = z.object({
	event_id: z.string().describe('Created event ID'),
	origin_server_ts: z.number().describe('Server timestamp'),
});

export const InternalReactionResponseDto = z.object({
	event_id: z.string().describe('Created reaction event ID'),
	origin_server_ts: z.number().describe('Server timestamp'),
}); 

export const InternalRedactMessageParamsDto = z.object({
	messageId: z.string().describe('Message ID to redact'),
});

export const InternalRedactMessageBodyDto = z.object({
	roomId: RoomIdDto,
	targetServer: ServerNameDto,
	reason: z.string().describe('Reason for redacting').optional(),
	senderUserId: UsernameDto,
});

export const InternalRedactMessageResponseDto = InternalMessageResponseDto;


export type InternalMessageResponse = z.infer<typeof InternalMessageResponseDto>;
export type InternalReactionResponse = z.infer<typeof InternalReactionResponseDto>;
export type InternalSendMessageBody = z.infer<typeof InternalSendMessageBodyDto>;
export type InternalUpdateMessageBody = z.infer<typeof InternalUpdateMessageBodyDto>;
export type InternalUpdateMessageParams = z.infer<typeof InternalUpdateMessageParamsDto>;
export type InternalSendReactionBody = z.infer<typeof InternalSendReactionBodyDto>;
export type InternalSendReactionParams = z.infer<typeof InternalSendReactionParamsDto>;
export type InternalRedactMessageBody = z.infer<typeof InternalRedactMessageBodyDto>;
export type InternalRedactMessageParams = z.infer<typeof InternalRedactMessageParamsDto>;
export type InternalRedactMessageResponse = z.infer<typeof InternalRedactMessageResponseDto>;