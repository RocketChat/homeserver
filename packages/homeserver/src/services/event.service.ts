import { Inject, Injectable, forwardRef } from "@nestjs/common";
import type { z } from "zod";
import { generateId } from "../authentication";
import { MatrixError } from "../errors";
import type { EventBase, EventStore } from "../models/event.model";
import {
	getPublicKeyFromRemoteServer,
	makeGetPublicKeyFromServerProcedure,
} from "../procedures/getPublicKeyFromServer";
import { EventRepository } from "../repositories/event.repository";
import { KeyRepository } from "../repositories/key.repository";
import { RoomRepository } from "../repositories/room.repository";
import { checkSignAndHashes } from "../utils/checkSignAndHashes";
import { Logger } from "../utils/logger";
import { eventSchemas } from "../validation/schemas/event-schemas";
import type { roomV10Type } from "../validation/schemas/room-v10.type";
import { ConfigService } from "./config.service";
import { StagingAreaService } from "./staging-area.service";

type ValidationResult = {
	eventId: string;
	event: roomV10Type;
	valid: boolean;
	error?: {
		errcode: string;
		error: string;
	};
};

interface StagedEvent {
	_id: string;
	event: EventBase;
	origin: string;
	missing_dependencies: string[];
	staged_at: number;
}

@Injectable()
export class EventService {
	private readonly logger = new Logger("EventService");

	constructor(
		@Inject(EventRepository) private readonly eventRepository: EventRepository,
		@Inject(RoomRepository) private readonly roomRepository: RoomRepository,
		@Inject(KeyRepository) private readonly keyRepository: KeyRepository,
		@Inject(ConfigService) private readonly configService: ConfigService,
		@Inject(forwardRef(() => StagingAreaService)) private readonly stagingAreaService: StagingAreaService
  ) {}

	async checkIfEventsExists(
		eventIds: string[],
	): Promise<{ missing: string[]; found: string[] }> {
		const events: Pick<EventStore, "_id">[] = await this.eventRepository.find(
			{ _id: { $in: eventIds } },
			{ projection: { _id: 1 } },
		);

		return eventIds.reduce(
			(acc: { missing: string[]; found: string[] }, id) => {
				const event = events.find((event) => event._id === id);

				if (event) {
					acc.found.push(event._id);
				} else {
					acc.missing.push(id);
				}

				return acc;
			},
			{ missing: [], found: [] },
		);
	}

	/**
	 * Check if an event exists in the database, including staged events
	 */
	async checkIfEventExistsIncludingStaged(eventId: string): Promise<boolean> {
		// First check regular events
		const regularEvent = await this.eventRepository.findById(eventId);
		if (regularEvent) {
			return true;
		}
		
		// Then check staged events
		const stagedEvents = await this.eventRepository.find({ 
			_id: eventId,
			is_staged: true 
		}, {});
		
		return stagedEvents.length > 0;
	}
	
	/**
	 * Store an event as staged with its missing dependencies
	 */
	async storeEventAsStaged(stagedEvent: StagedEvent): Promise<void> {
		try {
			// First check if the event already exists to avoid duplicates
			const existingEvent = await this.eventRepository.findById(stagedEvent._id);
			if (existingEvent) {
				// If it already exists as a regular event (not staged), nothing to do
				if (!(existingEvent as any).is_staged) {
					this.logger.debug(`Event ${stagedEvent._id} already exists as a regular event, nothing to stage`);
					return;
				}
				
				// Update the staged event with potentially new dependencies info
				await this.eventRepository.upsert(stagedEvent.event);
				// Make a separate update for metadata since upsert only handles the event data
				// We do this by using the createStaged method, which should update if exists
				await this.eventRepository.createStaged(stagedEvent.event);
				this.logger.debug(`Updated staged event ${stagedEvent._id} with ${stagedEvent.missing_dependencies.length} missing dependencies`);
			} else {
				// Create a new staged event
				await this.eventRepository.createStaged(stagedEvent.event);
				
				// Add metadata for tracking dependencies
				const collection = await (this.eventRepository as any).getCollection();
				await collection.updateOne(
					{ _id: stagedEvent._id },
					{ 
						$set: { 
							missing_dependencies: stagedEvent.missing_dependencies,
							staged_at: stagedEvent.staged_at,
							is_staged: true
						} 
					}
				);
				
				this.logger.debug(`Stored new staged event ${stagedEvent._id} with ${stagedEvent.missing_dependencies.length} missing dependencies`);
			}
		} catch (error) {
			this.logger.error(`Error storing staged event ${stagedEvent._id}: ${error}`);
			throw error;
		}
	}
	
	/**
	 * Find all staged events in the database
	 */
	async findStagedEvents(): Promise<StagedEvent[]> {
		// We need to find all events with the staged flag
		// The explicit is_staged flag might be present, or the traditional staged flag
		const events = await this.eventRepository.find(
			{ $or: [{ is_staged: true }, { staged: true }] }, 
			{}
		);
		return events as unknown as StagedEvent[];
	}
	
	/**
	 * Mark an event as no longer staged
	 */
	async markEventAsUnstaged(eventId: string): Promise<void> {
		try {
			// Use the existing repository method which is designed for this
			await this.eventRepository.removeFromStaging("", eventId); // Room ID not needed
			
			// Also remove other staging metadata we might have added
			// We need to do this directly since removeFromStaging only clears the staged flag
			const collection = await (this.eventRepository as any).getCollection();
			await collection.updateOne(
				{ _id: eventId },
				{ 
					$unset: { 
						is_staged: "", 
						missing_dependencies: "", 
						staged_at: "" 
					} 
				}
			);
			
			this.logger.debug(`Marked event ${eventId} as no longer staged`);
		} catch (error) {
			this.logger.error(`Error unmarking staged event ${eventId}: ${error}`);
			throw error;
		}
	}
	
	/**
	 * Remove a dependency from all staged events that reference it
	 */
	async removeDependencyFromStagedEvents(dependencyId: string): Promise<number> {
		try {
			// We need to do this manually since there's no repository method specifically for this
			let updatedCount = 0;
			
			// Get all staged events that have this dependency
			const collection = await (this.eventRepository as any).getCollection();
			const stagedEvents = await collection.find({
				$or: [{ is_staged: true }, { staged: true }],
				missing_dependencies: dependencyId
			}).toArray();
			
			// Update each one to remove the dependency
			for (const event of stagedEvents) {
				const missingDeps = event.missing_dependencies || [];
				const updatedDeps = missingDeps.filter((dep: string) => dep !== dependencyId);
				
				await collection.updateOne(
					{ _id: event._id },
					{ $set: { missing_dependencies: updatedDeps } }
				);
				
				updatedCount++;
			}
			
			return updatedCount;
		} catch (error) {
			this.logger.error(`Error removing dependency ${dependencyId} from staged events: ${error}`);
			throw error;
		}
	}

	async processIncomingPDUs(events: roomV10Type[]) {
		const eventsWithIds = events.map((event) => ({
			eventId: generateId(event),
			event,
			valid: true,
		}));

		const validatedEvents: ValidationResult[] = [];

		for (const event of eventsWithIds) {
			let result = await this.validateEventFormat(event.eventId, event.event);

			if (result.valid) {
				result = await this.validateEventTypeSpecific(
					event.eventId,
					event.event,
				);
			}

			if (result.valid) {
				result = await this.validateSignaturesAndHashes(
					event.eventId,
					event.event,
				);
			}

			validatedEvents.push(result);
		}

		for (const event of validatedEvents) {
			if (!event.valid) {
				this.logger.warn(`Validation failed for event ${event.eventId}: ${event.error?.errcode} - ${event.error?.error}`);
				continue;
			}

			this.stagingAreaService.addEventToQueue({
				eventId: event.eventId,
				roomId: event.event.room_id,
				origin: event.event.origin,
				event: event.event as unknown as EventBase,
			});
		}
	}

	private async validateEventFormat(eventId: string, event: roomV10Type): Promise<ValidationResult> {
		try {
			const roomVersion = await this.getRoomVersion(event);
			if (!roomVersion) {
				return {
					eventId,
					event,
					valid: false,
					error: {
						errcode: "M_UNKNOWN_ROOM_VERSION",
						error: "Could not determine room version for event",
					},
				};
			}

			const eventSchema = this.getEventSchema(roomVersion, event.type);
			const validationResult = eventSchema.safeParse(event);

			if (!validationResult.success) {
				const formattedErrors = JSON.stringify(validationResult.error.format());
				this.logger.error(`Event ${eventId} failed schema validation: ${formattedErrors}`);
				
				return {
					eventId,
					event,
					valid: false,
					error: {
						errcode: "M_SCHEMA_VALIDATION_FAILED",
						error: `Schema validation failed: ${formattedErrors}`,
					},
				};
			}
			return { eventId, event, valid: true };
		} catch (error: any) {
			const errorMessage = error?.message || String(error);
			this.logger.error(`Error validating format for ${eventId}: ${errorMessage}`);

			return {
				eventId,
				event,
				valid: false,
				error: {
					errcode: "M_FORMAT_VALIDATION_ERROR",
					error: `Error validating format: ${errorMessage}`,
				},
			};
		}
	}

	private async validateEventTypeSpecific(eventId: string, event: roomV10Type): Promise<ValidationResult> {
		try {
			if (event.type === "m.room.create") {
				const errors = this.validateCreateEvent(event);
				if (errors.length > 0) {
					this.logger.error(`Create event ${eventId} validation failed: ${errors.join(", ")}`);
					return {
						eventId,
						event,
						valid: false,
						error: {
							errcode: "M_INVALID_CREATE_EVENT",
							error: `Create event validation failed: ${errors[0]}`,
						},
					};
				}
			} else {
				const errors = this.validateNonCreateEvent(event);
				if (errors.length > 0) {
					this.logger.error(`Event ${eventId} validation failed: ${errors.join(", ")}`);
					return {
						eventId,
						event,
						valid: false,
						error: {
							errcode: "M_INVALID_EVENT",
							error: `Event validation failed: ${errors[0]}`,
						},
					};
				}
			}

			return { eventId, event, valid: true };
		} catch (error: any) {
			this.logger.error(`Error in type-specific validation for ${eventId}: ${error.message || String(error)}`);
			return {
				eventId,
				event,
				valid: false,
				error: {
					errcode: "M_TYPE_VALIDATION_ERROR",
					error: `Error in type-specific validation: ${error.message || String(error)}`,
				},
			};
		}
	}

	private async validateSignaturesAndHashes(
		eventId: string,
		event: roomV10Type,
	): Promise<ValidationResult> {
		try {
			const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
				(origin, keyId) =>
					this.keyRepository.getValidPublicKeyFromLocal(origin, keyId),
				(origin, key) =>
					getPublicKeyFromRemoteServer(
						origin,
						this.configService.getServerName(),
						key,
					),
				(origin, keyId, publicKey) =>
					this.keyRepository.storePublicKey(origin, keyId, publicKey),
			);

			await checkSignAndHashes(event, event.origin, getPublicKeyFromServer);
			return { eventId, event, valid: true };
		} catch (error: any) {
			this.logger.error(
				`Error validating signatures for ${eventId}: ${error.message || String(error)}`,
			);
			return {
				eventId,
				event,
				valid: false,
				error: {
					errcode: error instanceof MatrixError ? error.errcode : "M_UNKNOWN",
					error: error.message || String(error),
				},
			};
		}
	}

	private validateCreateEvent(event: any): string[] {
		const errors: string[] = [];

		if (event.prev_events && event.prev_events.length > 0) {
			errors.push("Create event must not have prev_events");
		}

		if (event.room_id && event.sender) {
			const roomDomain = this.extractDomain(event.room_id);
			const senderDomain = this.extractDomain(event.sender);

			if (roomDomain !== senderDomain) {
				errors.push(
					`Room ID domain (${roomDomain}) does not match sender domain (${senderDomain})`,
				);
			}
		}

		if (event.auth_events && event.auth_events.length > 0) {
			errors.push("Create event must not have auth_events");
		}

		if (!event.content || !event.content.room_version) {
			errors.push("Create event must specify a room_version");
		} else {
			const validRoomVersions = [
				"1",
				"2",
				"3",
				"4",
				"5",
				"6",
				"7",
				"8",
				"9",
				"10",
				"11",
			];
			if (!validRoomVersions.includes(event.content.room_version)) {
				errors.push(`Unsupported room version: ${event.content.room_version}`);
			}
		}

		return errors;
	}

	private validateNonCreateEvent(event: any): string[] {
		const errors: string[] = [];

		if (
			!event.prev_events ||
			!Array.isArray(event.prev_events) ||
			event.prev_events.length === 0
		) {
			errors.push("Event must reference previous events (prev_events)");
		}

		return errors;
	}

	private extractDomain(id: string): string {
		const parts = id.split(":");
		return parts.length > 1 ? parts[1] : "";
	}

	private async getRoomVersion(event: roomV10Type): Promise<string | null> {
		if (event.type === "m.room.create" && event.state_key === "") {
			const roomVersion = event.content?.room_version;
			if (roomVersion) {
				this.logger.debug(
					`Extracted room version ${roomVersion} from create event`,
				);
				return roomVersion as string;
			}
		}

		const cachedRoomVersion = await this.roomRepository.getRoomVersion(
			event.room_id,
		);
		if (cachedRoomVersion) {
			this.logger.debug(
				`Using cached room version ${cachedRoomVersion} for room ${event.room_id}`,
			);
			return cachedRoomVersion;
		}

		this.logger.warn(
			`Could not determine room version for ${event.room_id}, using default version 10`,
		);
		return "10";
	}

	private getEventSchema(roomVersion: string, eventType: string): z.ZodSchema {
		const versionSchemas = eventSchemas[roomVersion];
		if (!versionSchemas) {
			throw new Error(`Unsupported room version: ${roomVersion}`);
		}

		const schema = versionSchemas[eventType] || versionSchemas.default;
		if (!schema) {
			throw new Error(
				`No schema available for event type ${eventType} in room version ${roomVersion}`,
			);
		}

		return schema;
	}

	async insertEvent(event: EventBase, eventId?: string) {
		await this.eventRepository.create(event, eventId);
	}

	async getAuthEventsIdsForRoom(
		roomId: string,
		eventType?: string,
		senderId?: string,
	): Promise<string[]> {
		const query: any = {
			"event.room_id": roomId,
		};

		// Always include create and power_levels events
		const essentialTypes = [
			"m.room.create",
			"m.room.power_levels",
			"m.room.join_rules",
		];

		if (eventType === "m.room.message" && senderId) {
			// For message events, get essential auth events plus sender's membership
			const essentialEvents = await this.eventRepository.find(
				{
					"event.room_id": roomId,
					"event.type": { $in: essentialTypes },
				},
				{},
			);

			// First try to get the sender's join membership event
			let memberEvents = await this.eventRepository.find(
				{
					"event.room_id": roomId,
					"event.type": "m.room.member",
					"event.state_key": senderId,
					"event.content.membership": "join",
				},
				{},
			);

			// If no "join" membership is found, fall back to an "invite" membership as better than nothing
			if (memberEvents.length === 0) {
				this.logger.warn(`No join membership found for ${senderId} in room ${roomId}, checking for invite`);
				memberEvents = await this.eventRepository.find(
					{
						"event.room_id": roomId,
						"event.type": "m.room.member",
						"event.state_key": senderId,
						"event.content.membership": "invite",
					},
					{},
				);
				
				if (memberEvents.length > 0) {
					this.logger.warn(`Using invite membership for ${senderId} since no join event was found`);
				} else {
					this.logger.error(`No membership events found for ${senderId} in room ${roomId}`);
				}
			}

			// Combine both sets of events
			return [
				...essentialEvents.map((event) => event._id),
				...memberEvents.map((event) => event._id),
			];
		} else {
			// For other event types or when no specific filtering is requested
			query["event.type"] = {
				$in: [
					"m.room.create",
					"m.room.join_rules",
					"m.room.power_levels",
					"m.room.member",
				],
			};

			const authEvents = await this.eventRepository.find(query, {});
			return authEvents.map((event) => event._id);
		}
	}

	async getLastEventForRoom(roomId: string): Promise<EventStore | null> {
		return this.eventRepository.findLatestInRoom(roomId);
	}

	async getCreateEventForRoom(roomId: string): Promise<EventBase | null> {
		const createEvents = await this.eventRepository.find(
			{
				"event.room_id": roomId,
				"event.type": "m.room.create",
			},
			{ limit: 1 }
		);

		if (createEvents && createEvents.length > 0) {
			return createEvents[0].event;
		}
		
		return null;
	}

	async getMissingEvents(
		roomId: string,
		earliestEvents: string[],
		latestEvents: string[],
		limit: number,
	): Promise<EventBase[]> {
		// This is a simplified implementation; the real one would need to query events
		// between earliestEvents and latestEvents based on their depths
		const events = await this.eventRepository.find(
			{
				"event.room_id": roomId,
				_id: { $nin: [...earliestEvents, ...latestEvents] },
			},
			{ limit },
		);

		return events.map((event) => event.event);
	}

	async getEventsByIds(
		eventIds: string[],
	): Promise<{ _id: string; event: EventBase }[]> {
		if (!eventIds || eventIds.length === 0) {
			return [];
		}

		this.logger.debug(`Retrieving ${eventIds.length} events by IDs`);
		const events = await this.eventRepository.find({ _id: { $in: eventIds } }, {});

		return events.map((event) => ({
			_id: event._id,
			event: event.event,
		}));
	}

	/**
	 * Find events based on a query
	 */
	async findEvents(query: any, options: any = {}): Promise<{ _id: string; event: EventBase }[]> {
		this.logger.debug(`Finding events with query: ${JSON.stringify(query)}`);
		const events = await this.eventRepository.find(query, options);
		return events;
	}
	
	/**
	 * Find all events for a room
	 */
	async findRoomEvents(roomId: string): Promise<EventBase[]> {
		this.logger.debug(`Finding all events for room ${roomId}`);
		const events = await this.eventRepository.find(
			{ "event.room_id": roomId },
			{ sort: { "event.depth": 1 } }
		);
		return events.map(event => event.event);
	}
}
