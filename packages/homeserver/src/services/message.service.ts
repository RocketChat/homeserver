import { roomMessageEvent, type MessageAuthEvents, type RoomMessageEvent } from "@hs/core/src/events/m.room.message";
import { FederationService } from "@hs/federation-sdk";
import { Injectable } from "@nestjs/common";
import { signEvent, type SignedEvent } from "../signEvent";
import { ConfigService } from "./config.service";
import { EventService, EventType } from "./event.service";

@Injectable()
export class MessageService {
    constructor(
        private readonly eventService: EventService,
        private readonly configService: ConfigService,
        private readonly federationService: FederationService
    ) {}

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

		await this.federationService.sendEvent(targetServer, signedEvent);

		return signedEvent;
    }
}