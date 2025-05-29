import { FederationService } from "@hs/federation-sdk";
import { Injectable, Logger } from "@nestjs/common";
import type { z } from "zod";
import { generateId } from "../authentication";
import { MatrixError } from "../errors";
import type { EventBase, EventStore } from "../models/event.model";
import { pruneEventDict } from "../pruneEventDict";
import {
	getPublicKeyFromRemoteServer,
	makeGetPublicKeyFromServerProcedure,
} from "../procedures/getPublicKeyFromServer";
import { StagingAreaQueue } from "../queues/staging-area.queue";
import { EventRepository } from "../repositories/event.repository";
import { KeyRepository } from "../repositories/key.repository";
import { RoomRepository } from "../repositories/room.repository";
import { checkSignAndHashes } from "../utils/checkSignAndHashes";
import { eventSchemas } from "../utils/event-schemas";
import { ConfigService } from "./config.service";
import { RedactionEvent } from "@hs/core/src/events/m.room.redaction";

type ValidationResult = {
	eventId: string;
	event: EventBase;
	valid: boolean;
	error?: {
		errcode: string;
		error: string;
	};
};

export interface StagedEvent {
	_id: string;
	event: EventBase;
	origin: string;
	missing_dependencies: string[];
	staged_at: number;
	room_version?: string;
	invite_room_state?: Record<string, unknown>;
}

export enum EventType {
	CREATE = "m.room.create",
	POWER_LEVELS = "m.room.power_levels",
	MEMBER = "m.room.member",
	MESSAGE = "m.room.message",
	JOIN_RULES = "m.room.join_rules",
	REACTION = "m.reaction",
	REDACTION = "m.room.redaction",
}

interface AuthEventsOptions {
	roomId: string;
	eventType?: EventType | string;
	senderId?: string;
}

// Define a type for our query generators
type QueryGenerator = (options: AuthEventsOptions) => Promise<Record<string, any> | null> | Record<string, any> | null;

// Define a type for our event mapping
interface EventQueryMapping {
	[key: string]: QueryGenerator[];
}

@Injectable()
export class EventService {
	private readonly logger = new Logger(EventService.name);

	constructor(
		private readonly eventRepository: EventRepository,
		private readonly roomRepository: RoomRepository,
		private readonly keyRepository: KeyRepository,
		private readonly configService: ConfigService,
		private readonly stagingAreaQueue: StagingAreaQueue,
		private readonly federationService: FederationService,
	) { }

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

	async processIncomingPDUs(events: EventBase[]) {
		const eventsWithIds = events.map((event) => ({
			eventId: generateId(event),
			event,
			valid: true,
		}));

		const validatedEvents: ValidationResult[] = [];

		for (const { eventId, event } of eventsWithIds) {
			let result = await this.validateEventFormat(eventId, event);
			if (result.valid) {
				result = await this.validateEventTypeSpecific(
					eventId,
					event,
				);
			}

			if (result.valid) {
				result = await this.validateSignaturesAndHashes(
					eventId,
					event,
				);
			}

			validatedEvents.push(result);
		}

		for (const event of validatedEvents) {
			if (!event.valid) {
				this.logger.warn(`Validation failed for event ${event.eventId}: ${event.error?.errcode} - ${event.error?.error}`);
				continue;
			}

			this.stagingAreaQueue.enqueue({
				eventId: event.eventId,
				roomId: event.event.room_id,
				origin: event.event.origin,
				event: event.event as unknown as EventBase,
			});
		}
	}

	private async validateEventFormat(eventId: string, event: EventBase): Promise<ValidationResult> {
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

	private async validateEventTypeSpecific(eventId: string, event: EventBase): Promise<ValidationResult> {
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
		event: EventBase,
	): Promise<ValidationResult> {
		try {
			const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
				(origin, keyId) => this.keyRepository.getValidPublicKeyFromLocal(origin, keyId),
				(origin, key) =>
					getPublicKeyFromRemoteServer(
						origin,
						this.configService.getServerConfig().name,
						key,
					),
				(origin, keyId, publicKey) =>
					this.keyRepository.storePublicKey(origin, keyId, publicKey),
			);

			await checkSignAndHashes(event as any, event.origin, getPublicKeyFromServer);
			return { eventId, event, valid: true };
		} catch (error: any) {
			this.logger.error(`Error validating signatures for ${eventId}: ${error.message || String(error)}`);
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

	private async getRoomVersion(event: EventBase): Promise<string | null> {
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

	async insertEvent(event: EventBase, eventId?: string, args?: object): Promise<string> {
		return this.eventRepository.create(event, eventId, args);
	}

	async insertEventIfNotExists(event: EventBase): Promise<string> {
		return this.eventRepository.createIfNotExists(event);
	}

	async getAuthEventsIds(options: AuthEventsOptions): Promise<{ _id: string, type: string }[]> {
		const { eventType } = options;

		const queryGenerators: EventQueryMapping = {
			[EventType.MESSAGE]: [
				(opts) => ({ "event.room_id": opts.roomId, "event.type": EventType.CREATE }),
				(opts) => ({ "event.room_id": opts.roomId, "event.type": EventType.POWER_LEVELS }),
				async (opts) => {
					if (!opts.senderId) {
						return null;
					}

					// Try join membership first
					const joinQuery = {
						"event.room_id": opts.roomId,
						"event.type": EventType.MEMBER,
						"event.state_key": opts.senderId,
						"event.content.membership": "join"
					};

					const joinEvents = await this.eventRepository.find(joinQuery, {});

					// If join found, return that query
					if (joinEvents.length > 0) {
						return joinQuery;
					}

					// Otherwise, try invite membership
					this.logger.warn(`No join membership found for ${opts.senderId} in room ${opts.roomId}, checking for invite`);

					const inviteQuery = {
						"event.room_id": opts.roomId,
						"event.type": EventType.MEMBER,
						"event.state_key": opts.senderId,
						"event.content.membership": "invite"
					};

					const inviteEvents = await this.eventRepository.find(inviteQuery, {});

					if (inviteEvents.length > 0) {
						this.logger.warn(`Using invite membership for ${opts.senderId} since no join event was found`);
						return inviteQuery;
					}

					this.logger.error(`No membership events found for ${opts.senderId} in room ${opts.roomId}`);
					return null;
				}
			],
			[EventType.MEMBER]: [
				(opts) => ({ "event.room_id": opts.roomId, "event.type": EventType.CREATE }),
				(opts) => ({ "event.room_id": opts.roomId, "event.type": EventType.POWER_LEVELS }),
			],
			[EventType.REACTION]: [
				(opts) => ({ "event.room_id": opts.roomId, "event.type": EventType.CREATE }),
				(opts) => ({ "event.room_id": opts.roomId, "event.type": EventType.POWER_LEVELS }),
				async (opts) => {
					if (!opts.senderId) {
						return null;
					}

					// Try join membership first
					const joinQuery = {
						"event.room_id": opts.roomId,
						"event.type": EventType.MEMBER,
						"event.state_key": opts.senderId,
						"event.content.membership": "join"
					};

					const joinEvents = await this.eventRepository.find(joinQuery, {});

					// If join found, return that query
					if (joinEvents.length > 0) {
						return joinQuery;
					}

					// Otherwise, try invite membership
					this.logger.warn(`No join membership found for ${opts.senderId} in room ${opts.roomId}, checking for invite`);

					const inviteQuery = {
						"event.room_id": opts.roomId,
						"event.type": EventType.MEMBER,
						"event.state_key": opts.senderId,
						"event.content.membership": "invite"
					};

					const inviteEvents = await this.eventRepository.find(inviteQuery, {});

					if (inviteEvents.length > 0) {
						this.logger.warn(`Using invite membership for ${opts.senderId} since no join event was found`);
						return inviteQuery;
					}

					this.logger.error(`No membership events found for ${opts.senderId} in room ${opts.roomId}`);
					return null;
				}
			],
		};

		const generators = queryGenerators[eventType as string] || [];
		if (!generators) {
			throw new Error(`No generators found for event type ${eventType}`);
		}

		const authEvents: { _id: string, type: string }[] = [];

		for (const generator of generators) {
			const query = await generator(options);
			if (!query) {
				continue;
			}

			const events = await this.eventRepository.find(query, {});
			authEvents.push(...events.map(event => ({ _id: event._id, type: event.event.type })));
		}

		return authEvents;
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

	/**
	 * Find an invite event for a specific user in a specific room
	 */
	async findInviteEvent(roomId: string, userId: string): Promise<StagedEvent> {
		this.logger.debug(`Finding invite event for user ${userId} in room ${roomId}`);
		const events = await this.eventRepository.find(
			{
				"event.room_id": roomId,
				"event.type": "m.room.member",
				"event.state_key": userId,
				"event.content.membership": "invite"
			},
			{ limit: 1, sort: { "event.origin_server_ts": -1 } }
		) as StagedEvent[];

		return events[0];
	}

	async processRedaction(redactionEvent: RedactionEvent): Promise<boolean> {
		try {
			this.logger.debug(`[REDACTION] Processing redaction event with ID ${generateId(redactionEvent)}`);
			this.logger.debug(`[REDACTION] Redaction event sender: ${redactionEvent.sender}, room: ${redactionEvent.room_id}`);

			const eventIdToRedact = redactionEvent.content?.redacts;
			if (!eventIdToRedact) {
				this.logger.error(`[REDACTION] Event is missing 'redacts' field: ${generateId(redactionEvent)}`);
				return false;
			}

			this.logger.debug(`[REDACTION] Attempting to redact event: ${eventIdToRedact}`);

			const eventToRedact = await this.eventRepository.findById(eventIdToRedact);
			if (!eventToRedact) {
				this.logger.warn(`[REDACTION] Event to redact ${eventIdToRedact} not found`);
				return false;
			}

			this.logger.debug(`[REDACTION] Found event to redact: ${eventIdToRedact} of type ${eventToRedact.event.type}`);

			const roomVersion = await this.getRoomVersion(eventToRedact.event);
			this.logger.debug(`[REDACTION] Using room version: ${roomVersion}`);

			try {
				const redactedEventContent = pruneEventDict(eventToRedact.event, {
					updated_redaction_rules: true,
					restricted_join_rule_fix: true,
					implicit_room_creator: false,
					restricted_join_rule: true,
					special_case_aliases_auth: true,
					msc3389_relation_redactions: true,
				});

				if (!redactedEventContent.unsigned) {
					redactedEventContent.unsigned = {};
				}

				(redactedEventContent.unsigned as Record<string, unknown>).redacted_because = redactionEvent;
				this.logger.debug(`[REDACTION] Prepared redacted event content for ${eventIdToRedact}`);

				let updateSuccess = false;

				try {
					await this.eventRepository.update(eventIdToRedact, {
						event: redactedEventContent,
					});
					this.logger.debug(`[REDACTION] Successfully updated redacted event ${eventIdToRedact} with update method`);
					updateSuccess = true;
				} catch (updateError) {
					this.logger.error(`[REDACTION] Error using update method: ${updateError}`);
				}

				// Method 2: Use upsert if update failed
				if (!updateSuccess) {
					try {
						await this.eventRepository.upsert(redactedEventContent as EventBase);
						this.logger.debug(`[REDACTION] Successfully updated redacted event ${eventIdToRedact} with upsert method`);
						updateSuccess = true;
					} catch (upsertError) {
						this.logger.error(`[REDACTION] Error using upsert method: ${upsertError}`);
					}
				}

				this.logger.log(`Successfully redacted event ${eventIdToRedact}`);
				return true;
			} catch (innerError) {
				this.logger.error(`Error during redaction processing: ${innerError}`);
				return false;
			}
		} catch (error) {
			this.logger.error(`Unexpected error in processRedaction: ${error}`);
			return false;
		}
	}

	/**
	 * Update an event that has been redacted with the redacted content
	 */
	async updateRedactedEvent(eventId: string, redactedContent: Partial<EventBase>): Promise<void> {
		try {
			this.logger.debug(`Updating redacted event ${eventId}`);

			// First check if the event exists
			const eventExists = await this.eventRepository.findById(eventId);
			if (!eventExists) {
				this.logger.warn(`Cannot update redacted event ${eventId}: Event not found`);
				return;
			}

			// Update the event with the redacted content using direct update
			await this.eventRepository.update(eventId, { event: redactedContent as EventBase });

			this.logger.debug(`Successfully updated redacted event ${eventId}`);
		} catch (error) {
			this.logger.error(`Error updating redacted event ${eventId}: ${error}`);
			throw error;
		}
	}

	/**
	 * Get an event by its ID
	 */
	async getEventById(eventId: string): Promise<EventStore | null> {
		try {
			return await this.eventRepository.findById(eventId);
		} catch (error) {
			this.logger.error(`Error retrieving event ${eventId}: ${error}`);
			return null;
		}
	}

	/**
	 * Get all member events for a room
	 */
	async getMemberEventsForRoom(roomId: string): Promise<EventStore[]> {
		try {
			return await this.eventRepository.find(
				{
					"event.room_id": roomId,
					"event.type": EventType.MEMBER,
				},
				{}
			);
		} catch (error) {
			this.logger.error(`Error getting member events for room ${roomId}: ${error}`);
			return [];
		}
	}

	/**
	 * Find an event by its event_id or various other criteria if direct ID lookup fails
	 * This is useful when dealing with potentially inconsistent event references
	 */
	async findEventByIdOrAlternatives(eventId: string, roomId?: string): Promise<EventStore | null> {
		try {
			// First try direct ID lookup
			const directResult = await this.eventRepository.findById(eventId);
			if (directResult) {
				return directResult;
			}

			this.logger.debug(`Direct lookup failed for ${eventId}, trying alternative lookups`);

			// If we have a roomId, try to find the event by roomId and look for fields that might match
			if (roomId) {
				// Try to find an event with a matching event_id field or in content.redacts
				const alternatives = await this.eventRepository.find({
					$and: [
						{ "event.room_id": roomId },
						{
							$or: [
								{ "event.event_id": eventId },
								{ "event.content.redacts": eventId },
								{ "event.content.m.relates_to.event_id": eventId }
							]
						}
					]
				}, { limit: 1 });

				if (alternatives && alternatives.length > 0) {
					this.logger.debug(`Found event ${eventId} using alternative lookup: ${JSON.stringify(alternatives[0])}`);
					return alternatives[0];
				}
			}

			this.logger.debug(`No alternative matches found for event ${eventId}`);
			return null;
		} catch (error) {
			this.logger.error(`Error in findEventByIdOrAlternatives for ${eventId}: ${error}`);
			return null;
		}
	}
}
