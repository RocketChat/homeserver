import type { EventBase } from "@hs/core/src/events/eventBase";
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Post,
} from "@nestjs/common";
import type { SigningKey } from "../keys"; // Ensure SigningKey is imported if not already
import { RoomRepository } from "../repositories/room.repository";
import { ConfigService } from "../services/config.service";
import { EventService } from "../services/event.service";
import { FederationService } from "../services/federation.service";
import { signEvent } from "../signEvent";
import { Logger } from "../utils/logger";

@Controller("internal")
export class InternalMessageController {
	private readonly logger = new Logger("InternalMessageController");

	constructor(
    @Inject(FederationService) private readonly federationService: FederationService,
    @Inject(EventService) private readonly eventService: EventService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(RoomRepository) private readonly roomRepository: RoomRepository,
  ) {}

	@Post('send-signed-message')
  async sendSignedMessage(
    @Body() body: { roomId: string, targetServer: string, message: string, senderUserId: string }
  ): Promise<unknown> {
    const { roomId, targetServer, message, senderUserId } = body;
    this.logger.debug(`Received request to send message to room ${roomId} via ${targetServer} from ${senderUserId}`);

    try {
      const serverName = this.configService.getServerName();

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

      this.logger.debug(`Signing event for room ${roomId} with key ${signingKey.algorithm}:${signingKey.version}`);
      const signedEvent = await signEvent(eventForSigning, signingKey, serverName);

      this.logger.debug(`Dispatching event ${signedEvent.event_id} to server ${targetServer} for room ${roomId}`);
      await this.federationService.sendEventToServers(roomId, signedEvent, [targetServer]);

      this.logger.debug(`Federation service call initiated for event: ${signedEvent.event_id}`);

      return {
        message: 'Event built, signed, and dispatched to federation service',
        eventId: signedEvent.event_id,
        signedEvent: signedEvent
      };
    } catch (error: any) {
      this.logger.error(`Error in sendSignedMessage for room ${roomId}: ${error.message}`);
      throw new HttpException(
        `Failed to send message: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
} 