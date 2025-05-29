import { reactionEvent, type ReactionAuthEvents, type ReactionEvent } from "@hs/core/src/events/m.reaction";
import { redactionEvent, type RedactionAuthEvents, type RedactionEvent } from "@hs/core/src/events/m.room.redaction";
import { roomMessageEvent, type MessageAuthEvents, type RoomMessageEvent } from "@hs/core/src/events/m.room.message";
import { FederationService } from "@hs/federation-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { generateId } from "../authentication";
import { signEvent, type SignedEvent } from "../signEvent";
import { ConfigService } from "./config.service";
import { EventService, EventType } from "./event.service";

@Injectable()
export class MessageService {
    private readonly logger = new Logger(MessageService.name);

    constructor(
        private readonly eventService: EventService,
        private readonly configService: ConfigService,
        private readonly federationService: FederationService
    ) { }

    async sendMessage(roomId: string, message: string, senderUserId: string, targetServer: string): Promise<SignedEvent<RoomMessageEvent>> {
        const serverName = this.configService.getServerConfig().name;
        const signingKey = await this.configService.getSigningKey();

        const latestEventDoc = await this.eventService.getLastEventForRoom(roomId);
        const prevEvents = latestEventDoc ? [latestEventDoc._id] : [];

        const authEvents = await this.eventService.getAuthEventsIds({ roomId, eventType: EventType.MESSAGE, senderId: senderUserId });

        const currentDepth = latestEventDoc?.event?.depth ?? 0;
        const newDepth = currentDepth + 1;

        const authEventsMap: MessageAuthEvents = {
            "m.room.create": authEvents.find(event => event.type === EventType.CREATE)?._id || "",
            "m.room.power_levels": authEvents.find(event => event.type === EventType.POWER_LEVELS)?._id || "",
            "m.room.member": authEvents.find(event => event.type === EventType.MEMBER)?._id || "",
        };

        const { state_key, ...eventForSigning } = roomMessageEvent({
            roomId,
            sender: senderUserId,
            auth_events: authEventsMap,
            prev_events: prevEvents,
            depth: newDepth,
            content: {
                msgtype: "m.text",
                body: message,
                "m.mentions": {},
            },
            origin: serverName,
            ts: Date.now(),
        });

        const signedEvent = await signEvent(
            eventForSigning,
            Array.isArray(signingKey) ? signingKey[0] : signingKey,
            serverName
        );

        const eventId = generateId(signedEvent);
        await this.federationService.sendEvent(targetServer, signedEvent);
        await this.eventService.insertEvent(signedEvent, eventId);

        this.logger.log(`Sent message to ${targetServer} - ${eventId}`);

        return { ...signedEvent, event_id: eventId };
    }

    async sendReaction(roomId: string, eventId: string, emoji: string, senderUserId: string, targetServer: string): Promise<SignedEvent<ReactionEvent>> {
        const serverName = this.configService.getServerConfig().name;
        const signingKey = await this.configService.getSigningKey();

        const latestEventDoc = await this.eventService.getLastEventForRoom(roomId);
        const prevEvents = latestEventDoc ? [latestEventDoc._id] : [];

        const authEvents = await this.eventService.getAuthEventsIds({ roomId, eventType: EventType.REACTION, senderId: senderUserId });

        const currentDepth = latestEventDoc?.event?.depth ?? 0;
        const newDepth = currentDepth + 1;

        const authEventsMap: ReactionAuthEvents = {
            "m.room.create": authEvents.find(event => event.type === EventType.CREATE)?._id,
            "m.room.power_levels": authEvents.find(event => event.type === EventType.POWER_LEVELS)?._id,
            "m.room.member": authEvents.find(event => event.type === EventType.MEMBER)?._id,
        };

        if (!authEventsMap["m.room.create"] || !authEventsMap["m.room.power_levels"] || !authEventsMap["m.room.member"]) {
            throw new Error("There are missing auth events for the reaction event");
        }

        const { state_key, ...eventForSigning } = reactionEvent({
            roomId,
            sender: senderUserId,
            auth_events: authEventsMap,
            prev_events: prevEvents,
            depth: newDepth,
            content: {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: eventId,
                    key: emoji
                }
            },
            origin: serverName,
            ts: Date.now(),
        });

        const signedEvent = await signEvent(
            eventForSigning,
            Array.isArray(signingKey) ? signingKey[0] : signingKey,
            serverName
        );

        await this.federationService.sendEvent(targetServer, signedEvent);
        await this.eventService.insertEvent(signedEvent, eventId);

        this.logger.log(`Sent reaction ${emoji} to ${targetServer} for event ${eventId} - ${generateId(signedEvent)}`);

        return signedEvent;
    }

    async updateMessage(roomId: string, message: string, senderUserId: string, targetServer: string, eventIdToReplace: string): Promise<SignedEvent<RoomMessageEvent>> {
        const serverName = this.configService.getServerConfig().name;
        const signingKey = await this.configService.getSigningKey();

        const latestEventDoc = await this.eventService.getLastEventForRoom(roomId);
        const prevEvents = latestEventDoc ? [latestEventDoc._id] : [];

        const authEvents = await this.eventService.getAuthEventsIds({ roomId, eventType: EventType.MESSAGE, senderId: senderUserId });

        const currentDepth = latestEventDoc?.event?.depth ?? 0;
        const newDepth = currentDepth + 1;

        const authEventsMap: MessageAuthEvents = {
            "m.room.create": authEvents.find(event => event.type === EventType.CREATE)?._id || "",
            "m.room.power_levels": authEvents.find(event => event.type === EventType.POWER_LEVELS)?._id || "",
            "m.room.member": authEvents.find(event => event.type === EventType.MEMBER)?._id || "",
        };

        // For message edits, Matrix requires:
        // 1. A fallback body with "* " prefix for clients that don't support edits
        // 2. The new content directly in "m.new_content" (not inside m.relates_to)
        // 3. A relates_to field with rel_type: "m.replace" and event_id pointing to original
        const { state_key, ...eventForSigning } = roomMessageEvent({
            roomId,
            sender: senderUserId,
            auth_events: authEventsMap,
            prev_events: prevEvents,
            depth: newDepth,
            content: {
                msgtype: "m.text",
                body: `* ${message}`, // Fallback for clients not supporting edits
                "m.mentions": {},
                "m.relates_to": {
                    rel_type: "m.replace",
                    event_id: eventIdToReplace
                },
                "m.new_content": {
                    msgtype: "m.text",
                    body: message // The actual new content
                }
            },
            origin: serverName,
            ts: Date.now(),
        });

        const signedEvent = await signEvent(
            eventForSigning,
            Array.isArray(signingKey) ? signingKey[0] : signingKey,
            serverName
        );

        await this.federationService.sendEvent(targetServer, signedEvent);

        return signedEvent;
    }

    async redactMessage(roomId: string, eventIdToRedact: string, reason: string | undefined, senderUserId: string, targetServer: string): Promise<SignedEvent<RedactionEvent>> {
        const serverName = this.configService.getServerConfig().name;
        const signingKey = await this.configService.getSigningKey();

        const latestEventDoc = await this.eventService.getLastEventForRoom(roomId);
        const prevEvents = latestEventDoc ? [latestEventDoc._id] : [];

        const authEvents = await this.eventService.getAuthEventsIds({ roomId, eventType: EventType.MESSAGE, senderId: senderUserId });

        const currentDepth = latestEventDoc?.event?.depth ?? 0;
        const newDepth = currentDepth + 1;

        const authEventsMap: RedactionAuthEvents = {
            "m.room.create": authEvents.find((event) => event.type === EventType.CREATE)?._id || "",
            "m.room.power_levels": authEvents.find((event) => event.type === EventType.POWER_LEVELS)?._id || "",
            "m.room.member": authEvents.find((event) => event.type === EventType.MEMBER)?._id || "",
        };

        this.logger.debug(`Auth events map for redaction: ${JSON.stringify(authEventsMap)}`);

        if (!authEventsMap["m.room.create"] || !authEventsMap["m.room.power_levels"] || !authEventsMap["m.room.member"]) {
            throw new Error("There are missing critical auth events (create, power_levels, or sender's member event) for the redaction event on the sending server.");
        }

        const { state_key, ...eventForSigning } = redactionEvent({
            roomId,
            sender: senderUserId,
            auth_events: authEventsMap,
            prev_events: prevEvents,
            depth: newDepth,
            content: {
                redacts: eventIdToRedact,  // This will be moved to top level by redactionEvent
                ...(reason && { reason })
            },
            origin: serverName,
            ts: Date.now(),
        });

        this.logger.debug(`[REDACTION] Created redaction event: ${JSON.stringify(eventForSigning)}`);

        const signedEvent = await signEvent(
            eventForSigning,
            Array.isArray(signingKey) ? signingKey[0] : signingKey,
            serverName
        );

        this.logger.debug(`[REDACTION] Final event to be sent: ${JSON.stringify({
            type: signedEvent.type,
            content: signedEvent.content,
            redacts: signedEvent.redacts,
            room_id: signedEvent.room_id,
            sender: signedEvent.sender,
            origin_server_ts: signedEvent.origin_server_ts
        })}`);

        try {
            // First send the event to the target server
            await this.federationService.sendEvent(targetServer, signedEvent);
            this.logger.log(`Sent redaction event to target server ${targetServer}`);

            // Then store it in our database 
            await this.eventService.insertEvent(signedEvent);
            this.logger.log('Inserted redaction event in local database');

            // Finally, process the redaction locally
            const success = await this.eventService.processRedaction(signedEvent);
            if (success) {
                this.logger.log(`Successfully processed redaction for event ${eventIdToRedact}`);
            } else {
                this.logger.warn(`Failed to process redaction for event ${eventIdToRedact} locally on ${serverName}, but event was sent to ${targetServer}. The event may still be redacted by the receiving server.`);

                // Try a fallback approach - fetch the event directly and try redacting it
                const eventToRedact = await this.eventService.getEventById(eventIdToRedact);
                if (eventToRedact) {
                    this.logger.log(`Found event ${eventIdToRedact} for potential direct redaction`);
                    // The server may still handle this redaction even though our local processing failed
                }
            }

            return signedEvent;
        } catch (error) {
            this.logger.error(`Failed to send redaction event: ${error}`);
            throw new Error(`Failed to send redaction event: ${error}`);
        }
    }
}