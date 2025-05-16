import type { EventBase } from "@hs/core/src/events/eventBase";
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post
} from "@nestjs/common";
import type { SigningKey } from "../keys"; // Ensure SigningKey is imported if not already
import { ConfigService } from "../services/config.service";
import { EventService } from "../services/event.service";
import { FederationService } from "../services/federation.service";
import { signEvent } from "../signEvent";

@Controller("internal")
export class InternalMessageController {
	constructor(
    private readonly federationService: FederationService,
    private readonly eventService: EventService,
    private readonly configService: ConfigService,
  ) {}

	@Post('send-signed-message')
  async sendSignedMessage(
    @Body() body: { roomId: string, targetServer: string, message: string, senderUserId: string }
  ): Promise<unknown> {
    const { roomId, targetServer, message, senderUserId } = body;
    
    try {
      const serverName = this.configService.getServerConfig().name;

      const latestEventDoc = await this.eventService.getLastEventForRoom(roomId);
      const prevEvents = latestEventDoc ? [latestEventDoc._id] : [];
      
      // For m.room.message, typical auth events are create, power_levels, sender's member event.
      // getAuthEventsForRoom is a simplified fetch. A real implementation might need more targeted queries
      // for the *current* power_levels and the *sender's current membership*.
      // For this example, we'll assume getAuthEventsForRoom provides relevant event IDs.
      const authEventIds = await this.eventService.getAuthEventsIdsForRoom(roomId, 'm.room.message', senderUserId);
      console.log('authEventIds', authEventIds);
      const currentDepth = latestEventDoc?.event?.depth ?? 0;
      const newDepth = currentDepth + 1;

      const eventContent = {
        msgtype: 'm.text',
        body: message,
        "m.mentions": {},
      };

      const eventForSigning: EventBase = {
        type: 'm.room.message',
        room_id: roomId,
        sender: senderUserId,
        content: eventContent,
        origin: serverName,
        origin_server_ts: Date.now(),
        prev_events: prevEvents,
        auth_events: authEventIds,
        depth: newDepth,
        // state_key: undefined,
        unsigned: {},
      };

      console.log('eventForSigning', eventForSigning);

      const signingKeyResult = await this.configService.getSigningKey();
      const signingKey = (Array.isArray(signingKeyResult) ? signingKeyResult[0] : signingKeyResult) as SigningKey;

      if (!signingKey) {
        throw new Error('Signing key not found or configured');
      }

      const signedEvent = await signEvent(eventForSigning, signingKey, serverName);
      
      await this.federationService.sendEventToServers(roomId, signedEvent, [targetServer]);

      

      return {
        message: 'Event built, signed, and dispatched to federation service',
        eventId: signedEvent.event_id,
        signedEvent: signedEvent
      };
    } catch (error: unknown) {
      
      throw new HttpException(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
} 