import type { ReactionEvent } from "@hs/core/src/events/m.reaction";
import type { RoomMessageEvent } from "@hs/core/src/events/m.room.message";
import {
  Body,
  Controller,
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

type SendMessageResponseDto = SignedEvent<RoomMessageEvent>;

const SendReactionSchema = z.object({
  roomId: z.string(),
  targetServer: z.string(),
  eventId: z.string(),
  emoji: z.string(),
  senderUserId: z.string(),
});

type SendReactionResponseDto = SignedEvent<ReactionEvent>;

@Controller("internal")
export class InternalMessageController {
	constructor(private readonly messageService: MessageService) {}

	@Post("messages")
  async sendMessage(@Body(new ZodValidationPipe(SendMessageSchema)) body: z.infer<typeof SendMessageSchema>): Promise<SendMessageResponseDto> {
    return this.messageService.sendMessage(body.roomId, body.message, body.senderUserId, body.targetServer);
  }

  @Post("reactions")
  async sendReaction(@Body(new ZodValidationPipe(SendReactionSchema)) body: z.infer<typeof SendReactionSchema>): Promise<SendReactionResponseDto> {
    return this.messageService.sendReaction(body.roomId, body.eventId, body.emoji, body.senderUserId, body.targetServer);
  }
}