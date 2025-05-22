import type { RoomMessageEvent } from "@hs/core/src/events/m.room.message";
import {
  Body,
  Controller,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import { z } from "zod";
import { MessageService } from "../../services/message.service";
import type { SignedEvent } from "../../signEvent";

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

type SendMessageResponseDto = SignedEvent<RoomMessageEvent>;

@Controller("internal/messages")
export class InternalMessageController {
	constructor(private readonly messageService: MessageService) {}

	@Post()
  async sendMessage(@Body() body: z.infer<typeof SendMessageSchema>): Promise<SendMessageResponseDto> {
    return this.messageService.sendMessage(body.roomId, body.message, body.senderUserId, body.targetServer);
  }

  @Patch(":eventId")
  async updateMessage(
    @Param("eventId") eventId: string,
    @Body() body: z.infer<typeof UpdateMessageSchema>,
  ): Promise<SendMessageResponseDto> {
    return this.messageService.updateMessage(body.roomId, body.message, body.senderUserId, body.targetServer, eventId);
  }
}