import type { EventBase } from "@hs/core/src/events/eventBase";
import { roomMemberEvent, type AuthEvents as RoomMemberAuthEvents } from "@hs/core/src/events/m.room.member";
import { roomNameEvent, type RoomNameAuthEvents, type RoomNameEvent } from "@hs/core/src/events/m.room.name";
import {
	roomPowerLevelsEvent,
	type RoomPowerLevelsEvent
} from "@hs/core/src/events/m.room.power_levels";
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

	private validatePowerLevelChange(
		currentPowerLevelsContent: RoomPowerLevelsEvent["content"],
		senderId: string,
		targetUserId: string,
		newPowerLevel: number,
	): void {
		const senderPower = currentPowerLevelsContent.users?.[senderId] ?? currentPowerLevelsContent.users_default;

		// 1. Check if sender can modify m.room.power_levels event itself
		const requiredLevelToModifyEvent = 
			currentPowerLevelsContent.events?.["m.room.power_levels"] ?? 
			currentPowerLevelsContent.state_default ?? 
			100;

		if (senderPower < requiredLevelToModifyEvent) {
			this.logger.warn(
				`Sender ${senderId} (power ${senderPower}) lacks global permission (needs ${requiredLevelToModifyEvent}) to modify power levels event.`,
			);
			throw new HttpException(
				"You don't have permission to change power levels events.",
				HttpStatus.FORBIDDEN,
			);
		}

		// 2. Specific checks when changing another user's power level
		if (senderId !== targetUserId) {
			const targetUserCurrentPower = currentPowerLevelsContent.users?.[targetUserId] ?? currentPowerLevelsContent.users_default;

			// Rule: Cannot set another user's power level higher than one's own.
			if (newPowerLevel > senderPower) {
				this.logger.warn(
					`Sender ${senderId} (power ${senderPower}) cannot set user ${targetUserId}'s power to ${newPowerLevel} (higher than own).`,
				);
				throw new HttpException(
					"You cannot set another user's power level higher than your own.",
					HttpStatus.FORBIDDEN,
				);
			}

			// Rule: Cannot change power level of a user whose current power is >= sender's power.
			if (targetUserCurrentPower >= senderPower) {
				this.logger.warn(
					`Sender ${senderId} (power ${senderPower}) cannot change power level of user ${targetUserId} (current power ${targetUserCurrentPower}).`,
				);
				throw new HttpException(
					"You cannot change the power level of a user with equal or greater power than yourself.",
					HttpStatus.FORBIDDEN,
				);
			}
		} else {
			// Optional: If sender is changing their own power level.
			// The main check (requiredLevelToModifyEvent) already ensures they *can* send the event.
			// One might argue they shouldn't be able to elevate themselves beyond what others at their original level could grant them,
			// but if they have rights to change m.room.power_levels, they effectively control the rules.
			// For now, if they can modify the event, they can set their own level.
		}
	}

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
		
		const signedEventPart: Omit<SignedEvent<RoomNameEvent>, "event_id"> = 
			await signEvent(unsignedEvent, signingKey, serverName);
		
		const eventId = generateId(signedEventPart); 

		const signedEvent: SignedEvent<RoomNameEvent> = {
			...(signedEventPart as RoomNameEvent), // Spread the base event properties
			event_id: eventId,
			hashes: signedEventPart.hashes, // Explicitly include hashes
			signatures: signedEventPart.signatures, // Explicitly include signatures
		};
		
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

	async updateUserPowerLevel(
		roomId: string,
		userId: string,
		powerLevel: number,
		senderId: string,
		targetServers: string[] = [],
	): Promise<string> {
		this.logger.log(`Updating power level for user ${userId} in room ${roomId} to ${powerLevel} by ${senderId}`);

		const authEventIds = await this.eventService.getAuthEventIds(EventType.POWER_LEVELS, { roomId, senderId });
		const currentPowerLevelsEvent = await this.eventService.getEventById<RoomPowerLevelsEvent>(authEventIds.find(e => e.type === EventType.POWER_LEVELS)?._id || "");
		
		if (!currentPowerLevelsEvent) {
			this.logger.error(`No m.room.power_levels event found for room ${roomId}`);
			throw new HttpException("Room power levels not found, cannot update.", HttpStatus.NOT_FOUND);
		}

		this.validatePowerLevelChange(
			currentPowerLevelsEvent.content,
			senderId,
			userId,
			powerLevel
		);

		const createAuthResult = authEventIds.find(e => e.type === EventType.CREATE);
		const powerLevelsAuthResult = authEventIds.find(e => e.type === EventType.POWER_LEVELS);
		const memberAuthResult = authEventIds.find(e => e.type === EventType.MEMBER && e.state_key === senderId);

		const authEventsMap = {
			"m.room.create": createAuthResult?._id || "",
			"m.room.power_levels": powerLevelsAuthResult?._id || "",
			"m.room.member": memberAuthResult?._id || "",
		};
		
		// Ensure critical auth events were found
		if (!authEventsMap["m.room.create"] || !authEventsMap["m.room.power_levels"] || !authEventsMap["m.room.member"]) {
			this.logger.error(
				`Critical auth events missing for power level update. Create: ${authEventsMap["m.room.create"]}, PowerLevels: ${authEventsMap["m.room.power_levels"]}, Member: ${authEventsMap["m.room.member"]}`
			);
			throw new HttpException("Internal server error: Missing auth events for power level update.", HttpStatus.INTERNAL_SERVER_ERROR);
		}

		const lastEventStore = await this.eventService.getLastEventForRoom(roomId);
		if (!lastEventStore) {
			this.logger.error(`No last event found for room ${roomId}`);
			throw new HttpException("Room has no history, cannot update power levels", HttpStatus.BAD_REQUEST);
		}

		const serverName = this.configService.getServerConfig().name;
		if (!serverName) {
			this.logger.error("Server name is not configured. Cannot set event origin.");
			throw new HttpException("Server configuration error for event origin.", HttpStatus.INTERNAL_SERVER_ERROR);
		}

		const eventToSign = roomPowerLevelsEvent({
			roomId,
			members: [senderId, userId],
			auth_events: Object.values(authEventsMap).filter(id => typeof id === 'string'),
			prev_events: [lastEventStore.event.event_id!],
			depth: lastEventStore.event.depth + 1,
			content: {
				...currentPowerLevelsEvent.content,
				users: {
					...(currentPowerLevelsEvent.content.users || {}),
					[userId]: powerLevel,
				},
			},
			ts: Date.now()
		});

		const signingKeyConfig = await this.configService.getSigningKey();
		const signingKey: SigningKey = Array.isArray(signingKeyConfig) ? signingKeyConfig[0] : signingKeyConfig;

		const signedEvent: SignedEvent<RoomPowerLevelsEvent> = await signEvent(
			eventToSign, 
			signingKey, 
			serverName
		);

		const eventId = generateId(signedEvent); 

		// Store the event locally BEFORE attempting federation
		await this.eventService.insertEvent(signedEvent, eventId);
		this.logger.log(`Successfully created and stored m.room.power_levels event ${eventId} for room ${roomId}`);

		for (const server of targetServers) {
			if (server === this.configService.getServerConfig().name) {
				continue;
			}

			try {
				await this.federationService.sendEvent(server, signedEvent);
				this.logger.log(`Successfully sent m.room.power_levels event ${eventId} over federation to ${server} for room ${roomId}`);
			} catch (error) {
				this.logger.error(`Failed to send m.room.power_levels event ${eventId} over federation to ${server}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		return eventId;
	}

	async leaveRoom(roomId: string, senderId: string, targetServers: string[] = []): Promise<string> {
		this.logger.log(`User ${senderId} leaving room ${roomId}`);

		const lastEvent = await this.eventService.getLastEventForRoom(roomId);
		if (!lastEvent) {
			throw new HttpException("Room has no history, cannot leave", HttpStatus.BAD_REQUEST);
		}

		const authEventIds = await this.eventService.getAuthEventIds(EventType.MEMBER, { roomId, senderId });

		// For a leave event, the user must have permission to send m.room.member events.
		// This is typically covered by them being a member, but power levels might restrict it.
		const powerLevelsEventId = authEventIds.find(e => e.type === EventType.POWER_LEVELS)?._id;
		if (!powerLevelsEventId) {
			this.logger.warn(`No power_levels event found for room ${roomId}, cannot verify permission to leave.`);
			throw new HttpException("Cannot verify permission to leave room.", HttpStatus.FORBIDDEN);
		}

		const canLeaveRoom = await this.eventService.checkUserPermission(
			powerLevelsEventId,
			senderId,
			EventType.MEMBER 
		);

		if (!canLeaveRoom) {
			this.logger.warn(`User ${senderId} does not have permission to send m.room.member events in ${roomId} (i.e., to leave).`);
			throw new HttpException("You don't have permission to leave this room.", HttpStatus.FORBIDDEN);
		}
		
		const createEventId = authEventIds.find(e => e.type === EventType.CREATE)?._id;
		const memberEventId = authEventIds.find(e => e.type === EventType.MEMBER && e.state_key === senderId)?._id;

		if (!createEventId || !memberEventId) {
			this.logger.error(`Critical auth events missing for leave. Create: ${createEventId}, Member: ${memberEventId}`);
			throw new HttpException("Critical auth events missing, cannot leave room", HttpStatus.INTERNAL_SERVER_ERROR);
		}
		
		const authEvents: RoomMemberAuthEvents = {
			"m.room.create": createEventId,
			"m.room.power_levels": powerLevelsEventId,
			[`m.room.member:${senderId}`]: memberEventId,
		};

		const serverName = this.configService.getServerConfig().name;
		const signingKeyConfig = await this.configService.getSigningKey();
		const signingKey: SigningKey = Array.isArray(signingKeyConfig) ? signingKeyConfig[0] : signingKeyConfig;

		const unsignedEvent = roomMemberEvent({
			roomId,
			sender: senderId,
			state_key: senderId,
			auth_events: authEvents,
			prev_events: [lastEvent._id],
			depth: lastEvent.event.depth + 1,
			membership: "leave",
			origin: serverName,
			content: {
				membership: "leave",
			}
		});

		const signedEvent = await signEvent(unsignedEvent, signingKey, serverName);
		const eventId = generateId(signedEvent);
		
		// After leaving, update local room membership state if necessary (e.g., remove from active members list)
		// This might be handled by whatever consumes these events, or could be an explicit step here.
		// For now, we assume event persistence is the primary concern of this service method.

		for (const server of targetServers) {
			if (server === serverName) {
				continue;
			}

			try {
				await this.federationService.sendEvent(server, signedEvent);
				this.logger.log(`Successfully sent m.room.member (leave) event ${eventId} over federation to ${server} for room ${roomId}`);
			} catch (error) {
				this.logger.error(`Failed to send m.room.member (leave) event ${eventId} over federation to ${server}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		await this.eventService.insertEvent(signedEvent, eventId);
		this.logger.log(`Successfully created and stored m.room.member (leave) event ${eventId} for user ${senderId} in room ${roomId}`);

		return eventId;
	}
}
