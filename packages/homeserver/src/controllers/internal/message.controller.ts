import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post
} from "@nestjs/common";
import { EventService } from "../../services/event.service";

@Controller("internal")
export class InternalMessageController {
	constructor(private readonly eventService: EventService) {}

	@Post("messages")
  async sendMessage(@Body() body: { roomId: string, targetServer: string, message: string, senderUserId: string }): Promise<unknown> {
    const { roomId, targetServer, message, senderUserId } = body;
    
    try {
      const { eventId, signedEvent } = await this.eventService.createAndSignMessageEvent({
        roomId,
        message,
        senderUserId
      });

      await this.eventService.sendEventToServer(signedEvent, targetServer);

      return {
        message: 'Event built, signed, and dispatched to federation service',
        eventId,
        signedEvent
      };
    } catch (error: unknown) {
        throw new HttpException(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}