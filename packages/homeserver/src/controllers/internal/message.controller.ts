import type { ReactionEvent } from "@hs/core/src/events/m.reaction";
import type { RedactionEvent } from "@hs/core/src/events/m.room.redaction";
import type { RoomMessageEvent } from "@hs/core/src/events/m.room.message";
import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import { MessageService } from "../../services/message.service";
import type { SignedEvent } from "../../signEvent";
import { ZodValidationPipe } from '../../validation/pipes/zod-validation.pipe';

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

type SendReactionResponseDto = SignedEvent<ReactionEvent>;
type SendMessageResponseDto = SignedEvent<RoomMessageEvent>;
type RedactMessageResponseDto = SignedEvent<RedactionEvent>;

@Controller("internal/messages")
export class InternalMessageController {
	constructor(private readonly messageService: MessageService) {}

	@Post()
  async sendMessage(@Body(new ZodValidationPipe(SendMessageSchema)) body: z.infer<typeof SendMessageSchema>): Promise<SendMessageResponseDto> {
    return this.messageService.sendMessage(body.roomId, body.message, body.senderUserId, body.targetServer);
  }

  @Patch("/:messageId")
  async updateMessage(
    @Param("messageId", new ZodValidationPipe(z.string())) eventId: string,
    @Body(new ZodValidationPipe(UpdateMessageSchema)) body: z.infer<typeof UpdateMessageSchema>,
  ): Promise<SendMessageResponseDto> {
    return this.messageService.updateMessage(body.roomId, body.message, body.senderUserId, body.targetServer, eventId);
  }

  @Post("/:messageId/reactions")
  async sendReaction(
    @Param("messageId", new ZodValidationPipe(z.string())) messageId: string,
    @Body(new ZodValidationPipe(SendReactionSchema)) body: z.infer<typeof SendReactionSchema>): Promise<SendReactionResponseDto> {
    return this.messageService.sendReaction(body.roomId, messageId, body.emoji, body.senderUserId, body.targetServer);
  }

  @Delete("/:messageId")
  async redactMessage(
    @Param("messageId", new ZodValidationPipe(z.string())) eventId: string,
    @Body(new ZodValidationPipe(RedactMessageSchema)) body: z.infer<typeof RedactMessageSchema>,
  ): Promise<RedactMessageResponseDto> {
    return this.messageService.redactMessage(body.roomId, eventId, body.reason, body.senderUserId, body.targetServer);
  }
}