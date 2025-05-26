import type { EventBase } from "@hs/core/src/events/eventBase";
import { roomNameEvent, type RoomNameAuthEvents, type RoomNameEvent } from "@hs/core/src/events/m.room.name";
import { createSignedEvent } from "@hs/core/src/events/utils/createSignedEvent";
import { FederationService } from "@hs/federation-sdk";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { generateId } from "../authentication";
import type { SigningKey } from "../keys";
import type { EventStore, EventBase as ModelEventBase } from "../models/event.model";
import { createRoom } from "../procedures/createRoom";
import { RoomRepository } from "../repositories/room.repository";
import { signEvent, type SignedEvent } from "../signEvent";
import { ConfigService } from "./config.service";
import { EventService, EventType } from "./event.service";

// Utility function to create a random ID for room creation
function createMediaId(length: number) {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	let result = "";
	for (let i = 0; i < length; i++) {
		const randomIndex = Math.floor(Math.random() * characters.length);
		result += characters[randomIndex];
	}
	return result;
}

@Injectable()
export class RoomService {
	private readonly logger = new Logger(RoomService.name);

	constructor(
		private readonly roomRepository: RoomRepository,
		private readonly eventService: EventService,
		private readonly configService: ConfigService,
		private readonly federationService: FederationService,
	) {}

	async upsertRoom(roomId: string, state: ModelEventBase[]) {
		this.logger.log(
			`Upserting room ${roomId} with ${state.length} state events`,
		);

		// Find the create event to determine room version
		const createEvent = state.find((event) => event.type === "m.room.create");
		if (createEvent) {
			this.logger.log(`Found create event for room ${roomId}`);
		}

		// Find power levels
		const powerLevelsEvent = state.find(
			(event) => event.type === "m.room.power_levels",
		);
		if (powerLevelsEvent) {
			this.logger.log(`Found power levels event for room ${roomId}`);
		}

		// Count member events
		const memberEvents = state.filter(
			(event) => event.type === "m.room.member",
		);
		this.logger.log(`Room ${roomId} has ${memberEvents.length} member events`);

		try {
			await this.roomRepository.upsert(roomId, state);
			this.logger.log(`Successfully upserted room ${roomId}`);
		} catch (error) {
			this.logger.error(`Failed to upsert room ${roomId}: ${error}`);
			throw error;
		}
	}

	/**
	 * Create a new room with the given sender and username
	 */
	async createRoom(
		username: string,
		sender: string,
	): Promise<{
		roomId: string;
		events: EventBase[];
	}> {
		this.logger.debug(`Creating room for ${sender} with ${username}`);
		const config = this.configService.getServerConfig();
		const signingKey = await this.configService.getSigningKey();

		if (sender.split(":").pop() !== config.name) {
			throw new HttpException("Invalid sender", HttpStatus.BAD_REQUEST);
		}

		const roomId = `!${createMediaId(18)}:${config.name}`;
		const result = await createRoom(
			[sender, username],
			createSignedEvent(
				Array.isArray(signingKey) ? signingKey[0] : signingKey,
				config.name,
			),
			roomId,
		);

		if (result.events.filter(Boolean).length === 0) {
			throw new HttpException(
				"Error creating room",
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		for (const eventObj of result.events) {
			await this.eventService.insertEvent(eventObj.event, eventObj._id);
		}

		return {
			roomId: result.roomId,
			events: result.events.map((e) => e.event),
		};
	}

	async updateRoomName(roomId: string, name: string, senderId: string, targetServer: string): Promise<string> {
		this.logger.log(`Updating room name for ${roomId} to \"${name}\" by ${senderId}`);

		const lastEvent: EventStore | null = await this.eventService.getLastEventForRoom(roomId);
		if (!lastEvent) {
			throw new HttpException("Room has no history, cannot update name", HttpStatus.BAD_REQUEST);
		}

		const authEventIds = await this.eventService.getAuthEventIds(EventType.NAME, { roomId, senderId });
		const powerLevelsEventId = authEventIds.find(e => e.type === EventType.POWER_LEVELS)?._id;

		const canUpdateRoomName = await this.eventService.checkUserPermission(
			powerLevelsEventId || '',
			senderId,
			EventType.NAME
		);

		if (!canUpdateRoomName) {
			this.logger.warn(`User ${senderId} does not have permission to set room name in ${roomId} based on power levels.`);
			throw new HttpException("You don\'t have permission to set the room name.", HttpStatus.FORBIDDEN);
		}

		if (authEventIds.length < 3) { 
			this.logger.error(`Could not find all auth events for room name update. Found: ${JSON.stringify(authEventIds)}`);
			throw new HttpException("Not authorized or missing prerequisites to set room name", HttpStatus.FORBIDDEN);
		}

		const authEvents: RoomNameAuthEvents = {
			"m.room.create": authEventIds.find(e => e.type === EventType.CREATE)?._id || "",
			"m.room.power_levels": powerLevelsEventId || "",
			"m.room.member": authEventIds.find(e => e.type === EventType.MEMBER)?._id || "",
		};

		if (!authEvents["m.room.create"] || !authEvents["m.room.member"]) { // power_levels already checked
			this.logger.error(`Critical auth events missing (create or member). Create: ${authEvents["m.room.create"]}, Member: ${authEvents["m.room.member"]}`);
			throw new HttpException("Critical auth events missing, cannot set room name", HttpStatus.INTERNAL_SERVER_ERROR);
		}

		const roomNameEventPayload = {
			roomId,
			sender: senderId,
			auth_events: authEvents,
			prev_events: [lastEvent._id],
			depth: lastEvent.event.depth + 1,
			content: { name },
			origin: this.configService.getServerConfig().name,
		};
		
		const signingKeyConfig = await this.configService.getSigningKey();
		const signingKey: SigningKey = Array.isArray(signingKeyConfig) ? signingKeyConfig[0] : signingKeyConfig;
		const serverName = this.configService.getServerConfig().name;

		const unsignedEvent: RoomNameEvent = roomNameEvent(roomNameEventPayload);
		const signedEvent: SignedEvent<RoomNameEvent> = await signEvent(unsignedEvent, signingKey, serverName);
		
		const eventId = generateId(signedEvent); 
		const eventToStore: ModelEventBase = { ...signedEvent, event_id: eventId };

		await this.eventService.insertEvent(eventToStore, eventId);
		this.logger.log(`Successfully created and stored m.room.name event ${eventId} for room ${roomId}`);

		await this.roomRepository.updateRoomName(roomId, name);
		this.logger.log(`Successfully updated room name in repository for room ${roomId}`);

		for (const server of [targetServer]) {
			try {
				await this.federationService.sendEvent(server, signedEvent as unknown as EventBase);
				this.logger.log(`Successfully sent m.room.name event ${eventId} over federation to ${server} for room ${roomId}`);
			} catch (error) {
				this.logger.error(`Failed to send m.room.name event ${eventId} over federation to ${server}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		return eventId;
	}
}
