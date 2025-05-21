import type { RoomMessageEvent } from "@hs/core/src/events/m.room.message";
import {
  Body,
  Controller,
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

type SendMessageResponseDto = SignedEvent<RoomMessageEvent>;

@Controller("internal")
export class InternalMessageController {
	constructor(private readonly messageService: MessageService) {}

	@Post("messages")
  async sendMessage(@Body() body: z.infer<typeof SendMessageSchema>): Promise<SendMessageResponseDto> {
    return this.messageService.sendMessage(body.roomId, body.message, body.senderUserId, body.targetServer);
  }
}