import type {
	BaseEDU,
	PresenceEDU,
	RoomPowerLevelsEvent,
	TypingEDU,
} from '@hs/core';
import { isPresenceEDU, isTypingEDU } from '@hs/core';
import type { RedactionEvent } from '@hs/core';
import { generateId } from '@hs/core';
import { MatrixError } from '@hs/core';
import type { EventBaseWithOptionalId, EventStore } from '@hs/core';
import {
	getPublicKeyFromRemoteServer,
	makeGetPublicKeyFromServerProcedure,
} from '@hs/core';
import { pruneEventDict } from '@hs/core';

import { checkSignAndHashes } from '@hs/core';
import { createLogger } from '@hs/core';
import { PersistentEventFactory } from '@hs/room';
import { inject, singleton } from 'tsyringe';
import type { z } from 'zod';
import type { StagingAreaQueue } from '../queues/staging-area.queue';
import type { EventRepository } from '../repositories/event.repository';
import type { KeyRepository } from '../repositories/key.repository';
import type { RoomRepository } from '../repositories/room.repository';
import { eventSchemas } from '../utils/event-schemas';
import type { ConfigService } from './config.service';
import { EventEmitterService } from './event-emitter.service';
import type { StateService } from './state.service';

type ValidationResult = {
	eventId: string;
	event: EventBaseWithOptionalId;
	valid: boolean;
	error?: {
		errcode: string;
		error: string;
	};
};

// TODO: Merge with EventStore from event.model.ts
export interface StagedEvent {
	_id: string;
	event: EventBaseWithOptionalId;
	origin: string;
	missing_dependencies: string[];
	room_version?: string;
	invite_room_state?: Record<string, unknown>;
}

export enum EventType {
	CREATE = 'm.room.create',
	MEMBER = 'm.room.member',
	MESSAGE = 'm.room.message',
	REDACTION = 'm.room.redaction',
	REACTION = 'm.reaction',
	NAME = 'm.room.name',
	POWER_LEVELS = 'm.room.power_levels',
}

type EventAttributes = {
	[EventType.NAME]: { roomId: string; senderId: string };
	[EventType.MESSAGE]: { roomId: string; senderId: string };
	[EventType.REACTION]: { roomId: string; senderId: string };
	[EventType.MEMBER]: { roomId: string; senderId: string };
	[EventType.CREATE]: { roomId: string };
	[EventType.POWER_LEVELS]: { roomId: string; senderId: string };
	[EventType.REDACTION]: { roomId: string; senderId: string };
};

interface AuthEventResult {
	_id: string;
	type: EventType;
	state_key?: string;
}

interface QueryConfig {
	query: Record<string, any>;
	sort?: Record<string, 1 | -1>;
	limit?: number;
}

export interface AuthEventParams {
	roomId: string;
	senderId: string;
}

@singleton()
export class EventService {
	private readonly logger = createLogger('EventService');

	constructor(
		@inject('EventRepository')
		private readonly eventRepository: EventRepository,
		@inject('RoomRepository') private readonly roomRepository: RoomRepository,
		@inject('KeyRepository') private readonly keyRepository: KeyRepository,
		@inject('ConfigService') private readonly configService: ConfigService,
		@inject('StagingAreaQueue')
		private readonly stagingAreaQueue: StagingAreaQueue,
		@inject('StateService') private readonly stateService: StateService,
		@inject(EventEmitterService)
		private readonly eventEmitterService: EventEmitterService,
	) {}

	async getEventById<T extends EventBaseWithOptionalId>(
		eventId: string,
	): Promise<T | null> {
		const event = await this.eventRepository.findById(eventId);
		return (event?.event as T) ?? null;
	}

	async checkIfEventsExists(
		eventIds: string[],
	): Promise<{ missing: string[]; found: string[] }> {
		const eventsCursor = await this.eventRepository.findByIds(eventIds);
		const events = await eventsCursor.toArray();

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
	 * Store an event as staged with its missing dependencies
	 */
	async storeEventAsStaged(stagedEvent: StagedEvent): Promise<void> {
		try {
			// First check if the event already exists to avoid duplicates
			const existingEvent = await this.eventRepository.findById(
				stagedEvent._id,
			);
			if (existingEvent) {
				// If it already exists as a regular event (not staged), nothing to do
				if (!existingEvent.is_staged) {
					this.logger.debug(
						`Event ${stagedEvent._id} already exists as a regular event, nothing to stage`,
					);
					return;
				}

				// Update the staged event with potentially new dependencies info
				await this.eventRepository.upsert(stagedEvent.event);
				// Make a separate update for metadata since upsert only handles the event data
				// We do this by using the createStaged method, which should update if exists
				await this.eventRepository.createStaged(stagedEvent.event);
				this.logger.debug(
					`Updated staged event ${stagedEvent._id} with ${stagedEvent.missing_dependencies.length} missing dependencies`,
				);
			} else {
				await this.eventRepository.createStaged(stagedEvent.event);

				this.logger.debug(
					`Stored new staged event ${stagedEvent._id} with ${stagedEvent.missing_dependencies.length} missing dependencies`,
				);
			}
		} catch (error) {
			this.logger.error(
				`Error storing staged event ${stagedEvent._id}: ${error}`,
			);
			throw error;
		}
	}

	/**
	 * Find all staged events in the database
	 */
	async findStagedEvents(): Promise<EventStore[]> {
		return await this.eventRepository.findStagedEvents();
	}

	/**
	 * Mark an event as no longer staged
	 */
	async markEventAsUnstaged(eventId: string): Promise<void> {
		try {
			await this.eventRepository.removeFromStaging(eventId);
			this.logger.debug(`Marked event ${eventId} as no longer staged`);
		} catch (error) {
			this.logger.error(`Error unmarking staged event ${eventId}: ${error}`);
			throw error;
		}
	}

	/**
	 * Remove a dependency from all staged events that reference it
	 */
	async removeDependencyFromStagedEvents(
		dependencyId: string,
	): Promise<number> {
		try {
			// We need to do this manually since there's no repository method specifically for this
			let updatedCount = 0;

			// Get all staged events that have this dependency
			const stagedEvents =
				await this.eventRepository.findStagedEventsByDependencyId(dependencyId);

			// Update each one to remove the dependency
			for await (const event of stagedEvents) {
				const updatedDeps = event.missing_dependencies?.filter(
					(dep: string) => dep !== dependencyId,
				);
				if (updatedDeps) {
					await this.eventRepository.setMissingDependencies(
						event._id,
						updatedDeps,
					);
					updatedCount++;
				}
			}

			return updatedCount;
		} catch (error) {
			this.logger.error(
				`Error removing dependency ${dependencyId} from staged events: ${error}`,
			);
			throw error;
		}
	}

	async processIncomingPDUs(pdus: EventBaseWithOptionalId[]): Promise<void> {
		console.log('processIncomingPDUs', pdus);
		const eventsWithIds = pdus.map((event) => ({
			eventId: generateId(event),
			event,
			valid: true,
		}));

		const validatedEvents: ValidationResult[] = [];

		for (const { eventId, event } of eventsWithIds) {
			// TODO: Rewrite this poor typing
			let result = await this.validateEventFormat(eventId, event);
			if (result.valid) {
				result = await this.validateEventTypeSpecific(eventId, event);
			}

			if (result.valid) {
				result = await this.validateSignaturesAndHashes(eventId, event);
			}

			validatedEvents.push(result);
		}

		for (const event of validatedEvents) {
			if (!event.valid) {
				this.logger.warn(
					`Validation failed for event ${event.eventId}: ${event.error?.errcode} - ${event.error?.error}`,
				);
				continue;
			}

			this.stagingAreaQueue.enqueue({
				eventId: event.eventId,
				roomId: event.event.room_id,
				origin: event.event.origin,
				event: event.event,
			});
		}
	}

	async processIncomingEDUs(edus: BaseEDU[]): Promise<void> {
		this.logger.debug(`Processing ${edus.length} incoming EDUs`);

		for (const edu of edus) {
			try {
				await this.processEDU(edu);
			} catch (error) {
				this.logger.error(
					`Error processing EDU of type ${edu.edu_type}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				// Continue processing other EDUs even if one fails
			}
		}
	}

	private async processEDU(edu: BaseEDU): Promise<void> {
		const { origin } = edu;

		if (isTypingEDU(edu)) {
			await this.processTypingEDU(edu, origin);
			return;
		}
		if (isPresenceEDU(edu)) {
			await this.processPresenceEDU(edu, origin);
			return;
		}
		return;
	}

	private async processTypingEDU(
		typingEDU: TypingEDU,
		origin?: string,
	): Promise<void> {
		const { room_id, user_id, typing } = typingEDU.content;

		if (!room_id || !user_id || typeof typing !== 'boolean') {
			this.logger.warn(
				'Invalid typing EDU content, missing room_id, user_id, or typing',
			);
			return;
		}

		this.logger.debug(
			`Processing typing notification for room ${room_id}: ${user_id} (typing: ${typing})`,
		);

		this.eventEmitterService.emit('homeserver.matrix.typing', {
			room_id,
			user_id,
			typing,
			origin,
		});
	}

	private async processPresenceEDU(
		presenceEDU: PresenceEDU,
		origin?: string,
	): Promise<void> {
		const { push } = presenceEDU.content;

		if (!push || !Array.isArray(push)) {
			this.logger.warn('Invalid presence EDU content, missing push array');
			return;
		}

		for (const presenceUpdate of push) {
			if (!presenceUpdate.user_id || !presenceUpdate.presence) {
				this.logger.warn(
					'Invalid presence update, missing user_id or presence',
				);
				continue;
			}

			this.logger.debug(
				`Processing presence update for ${presenceUpdate.user_id}: ${
					presenceUpdate.presence
				}${
					presenceUpdate.last_active_ago !== undefined
						? ` (${presenceUpdate.last_active_ago}ms ago)`
						: ''
				}`,
			);

			this.eventEmitterService.emit('homeserver.matrix.presence', {
				user_id: presenceUpdate.user_id,
				presence: presenceUpdate.presence,
				last_active_ago: presenceUpdate.last_active_ago,
				origin,
			});
		}
	}

	private async validateEventFormat(
		eventId: string,
		event: EventBaseWithOptionalId,
	): Promise<ValidationResult> {
		try {
			const roomVersion = await this.getRoomVersion(event);
			if (!roomVersion) {
				return {
					eventId,
					event,
					valid: false,
					error: {
						errcode: 'M_UNKNOWN_ROOM_VERSION',
						error: 'Could not determine room version for event',
					},
				};
			}

			const eventSchema = this.getEventSchema(roomVersion, event.type);
			const validationResult = eventSchema.safeParse(event);

			if (!validationResult.success) {
				const formattedErrors = JSON.stringify(validationResult.error.format());
				this.logger.error(
					`Event ${eventId} failed schema validation: ${formattedErrors}`,
				);

				return {
					eventId,
					event,
					valid: false,
					error: {
						errcode: 'M_SCHEMA_VALIDATION_FAILED',
						error: `Schema validation failed: ${formattedErrors}`,
					},
				};
			}
			return { eventId, event, valid: true };
		} catch (error: any) {
			const errorMessage = error?.message || String(error);
			this.logger.error(
				`Error validating format for ${eventId}: ${errorMessage}`,
			);

			return {
				eventId,
				event,
				valid: false,
				error: {
					errcode: 'M_FORMAT_VALIDATION_ERROR',
					error: `Error validating format: ${errorMessage}`,
				},
			};
		}
	}

	private async validateEventTypeSpecific(
		eventId: string,
		event: EventBaseWithOptionalId,
	): Promise<ValidationResult> {
		try {
			if (event.type === 'm.room.create') {
				const errors = this.validateCreateEvent(event);
				if (errors.length > 0) {
					this.logger.error(
						`Create event ${eventId} validation failed: ${errors.join(', ')}`,
					);
					return {
						eventId,
						event,
						valid: false,
						error: {
							errcode: 'M_INVALID_CREATE_EVENT',
							error: `Create event validation failed: ${errors[0]}`,
						},
					};
				}
			} else {
				const errors = this.validateNonCreateEvent(event);
				if (errors.length > 0) {
					this.logger.error(
						`Event ${eventId} validation failed: ${errors.join(', ')}`,
					);
					return {
						eventId,
						event,
						valid: false,
						error: {
							errcode: 'M_INVALID_EVENT',
							error: `Event validation failed: ${errors[0]}`,
						},
					};
				}
			}

			return { eventId, event, valid: true };
		} catch (error: any) {
			this.logger.error(
				`Error in type-specific validation for ${eventId}: ${
					error.message || String(error)
				}`,
			);
			return {
				eventId,
				event,
				valid: false,
				error: {
					errcode: 'M_TYPE_VALIDATION_ERROR',
					error: `Error in type-specific validation: ${
						error.message || String(error)
					}`,
				},
			};
		}
	}

	private async validateSignaturesAndHashes(
		eventId: string,
		event: EventBaseWithOptionalId,
	): Promise<ValidationResult> {
		try {
			const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
				(origin, keyId) =>
					this.keyRepository.getValidPublicKeyFromLocal(origin, keyId),
				(origin, key) =>
					getPublicKeyFromRemoteServer(
						origin,
						this.configService.getServerConfig().name,
						key,
					),
				(origin, keyId, publicKey) =>
					this.keyRepository.storePublicKey(origin, keyId, publicKey),
			);

			await checkSignAndHashes(
				event as any,
				event.origin,
				getPublicKeyFromServer,
			);
			return { eventId, event, valid: true };
		} catch (error: any) {
			this.logger.error(
				`Error validating signatures for ${eventId}: ${
					error.message || String(error)
				}`,
			);
			return {
				eventId,
				event,
				valid: false,
				error: {
					errcode: error instanceof MatrixError ? error.errcode : 'M_UNKNOWN',
					error: error.message || String(error),
				},
			};
		}
	}

	private validateCreateEvent(event: any): string[] {
		const errors: string[] = [];

		if (event.prev_events && event.prev_events.length > 0) {
			errors.push('Create event must not have prev_events');
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
			errors.push('Create event must not have auth_events');
		}

		if (!event.content || !event.content.room_version) {
			errors.push('Create event must specify a room_version');
		} else {
			const validRoomVersions = [
				'1',
				'2',
				'3',
				'4',
				'5',
				'6',
				'7',
				'8',
				'9',
				'10',
				'11',
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
			errors.push('Event must reference previous events (prev_events)');
		}

		return errors;
	}

	private extractDomain(id: string): string {
		const parts = id.split(':');
		return parts.length > 1 ? parts[1] : '';
	}

	private async getRoomVersion(event: EventBaseWithOptionalId) {
		return (
			this.stateService.getRoomVersion(event.room_id) ||
			PersistentEventFactory.defaultRoomVersion
		);
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

	async insertEvent(
		event: EventBaseWithOptionalId,
		eventId?: string,
		args?: object,
	): Promise<string> {
		// @ts-ignore: I am not using this code, ts-ignore to avoid ci problems for now
		return this.eventRepository.create(event, eventId || '', args);
	}

	async getLastEventForRoom(roomId: string): Promise<EventStore | null> {
		return this.eventRepository.findLatestFromRoomId(roomId);
	}

	async getCreateEventForRoom(
		roomId: string,
	): Promise<EventBaseWithOptionalId | null> {
		const createEvent = await this.eventRepository.findByRoomIdAndType(
			roomId,
			'm.room.create',
		);
		return createEvent?.event ?? null;
	}

	async getMissingEvents(
		roomId: string,
		earliestEvents: string[],
		latestEvents: string[],
		limit: number,
	): Promise<{ events: { _id: string; event: EventBaseWithOptionalId }[] }> {
		// TODO: This would benefit from adding projections to the query
		const eventsCursor =
			await this.eventRepository.findByRoomIdExcludingEventIds(
				roomId,
				[...earliestEvents, ...latestEvents],
				limit,
			);
		const events = await eventsCursor.toArray();

		return {
			events: events.map((event) => ({
				_id: event._id,
				event: event.event,
			})),
		};
	}

	async getEventsByIds(
		eventIds: string[],
	): Promise<{ _id: string; event: EventBaseWithOptionalId }[]> {
		if (!eventIds || eventIds.length === 0) {
			return [];
		}

		this.logger.debug(`Retrieving ${eventIds.length} events by IDs`);
		// TODO: This would benefit from adding projections to the query
		const events = await (
			await this.eventRepository.findByIds(eventIds)
		).toArray();
		return events.map((event) => ({
			_id: event._id,
			event: event.event,
		}));
	}

	/**
	 * Find an invite event for a specific user in a specific room
	 */
	async findInviteEvent(
		roomId: string,
		userId: string,
	): Promise<EventStore | null> {
		return await this.eventRepository.findInviteEventsByRoomIdAndUserId(
			roomId,
			userId,
		);
	}

	async getAuthEventIds(
		eventType: EventType,
		params: AuthEventParams,
	): Promise<AuthEventResult[]> {
		const queries = this.getAuthEventQueries(eventType, params);
		const authEvents: AuthEventResult[] = [];

		for (const queryConfig of queries) {
			const eventsCursor = await this.eventRepository.find(queryConfig.query, {
				sort: queryConfig.sort,
				limit: queryConfig.limit,
				projection: { _id: 1, 'event.type': 1, 'event.state_key': 1 },
			});
			const events = await eventsCursor.toArray();

			for (const storeEvent of events) {
				const currentEventType = storeEvent.event?.type as EventType;
				const currentStateKey = storeEvent.event?.state_key;
				const eventTypeKey = Object.keys(EventType).find(
					(key) =>
						EventType[key as keyof typeof EventType] === currentEventType,
				);

				if (eventTypeKey && currentEventType) {
					authEvents.push({
						_id: storeEvent._id,
						type: currentEventType,
						...(currentStateKey !== undefined && {
							state_key: currentStateKey,
						}),
					});
				} else {
					this.logger.warn(
						`EventStore with id ${storeEvent._id} has an unrecognized event type: ${storeEvent.event?.type}`,
					);
				}
			}
		}
		return authEvents;
	}

	async processRedaction(redactionEvent: RedactionEvent): Promise<void> {
		const eventIdToRedact = redactionEvent.redacts;
		if (!eventIdToRedact) {
			this.logger.error(
				`[REDACTION] Event is missing 'redacts' field: ${generateId(
					redactionEvent,
				)}`,
			);
			return;
		}

		const eventToRedact = await this.eventRepository.findById(eventIdToRedact);
		if (!eventToRedact) {
			this.logger.warn(
				`[REDACTION] Event to redact ${eventIdToRedact} not found`,
			);
			return;
		}

		// Apply redaction rules according to Matrix spec for room versions 6 and above
		// These parameters correspond to the features in newer room versions (v6+):
		// - updated_redaction_rules: Uses stricter redaction rules from v6+
		// - restricted_join_rule_fix: Preserves "authorising_user" field in membership events (v8+)
		// - restricted_join_rule: Preserves "allow" field in join rules (v7+)
		// - special_case_aliases_auth: Special handling for aliases events (v6+)
		// - msc3389_relation_redactions: Preserves certain relation data per MSC3389 (v9+)
		const redactedEventContent = pruneEventDict(eventToRedact.event, {
			updated_redaction_rules: true,
			restricted_join_rule_fix: true,
			implicit_room_creator: false,
			restricted_join_rule: true,
			special_case_aliases_auth: true,
			msc3389_relation_redactions: true,
		});

		// According to Matrix spec, redacted events must contain a reference to what redacted them
		// in the unsigned section of the event
		if (!redactedEventContent.unsigned) {
			redactedEventContent.unsigned = {};
		}

		// Store the redaction event in the redacted_because field as specified in the Matrix spec
		redactedEventContent.unsigned.redacted_because = redactionEvent;

		const finalRedactedEvent: EventBaseWithOptionalId = {
			type: eventToRedact.event.type,
			room_id: eventToRedact.event.room_id,
			sender: eventToRedact.event.sender,
			origin: eventToRedact.event.origin,
			origin_server_ts: eventToRedact.event.origin_server_ts,
			depth: eventToRedact.event.depth,
			prev_events: eventToRedact.event.prev_events,
			auth_events: eventToRedact.event.auth_events,
			...redactedEventContent,
		};

		await this.eventRepository.redactEvent(eventIdToRedact, finalRedactedEvent);

		this.logger.info(`Successfully redacted event ${eventIdToRedact}`);
	}

	private getAuthEventQueries<T extends EventType>(
		eventType: T,
		attributes: EventAttributes[T],
	): QueryConfig[] {
		const { roomId } = attributes;
		const senderId = 'senderId' in attributes ? attributes.senderId : undefined;

		const baseQueries = {
			create: {
				query: { 'event.room_id': roomId, 'event.type': EventType.CREATE },
			},
			powerLevels: {
				query: {
					'event.room_id': roomId,
					'event.type': EventType.POWER_LEVELS,
				},
				sort: { 'event.origin_server_ts': -1 },
				limit: 1,
			},
			membership: {
				query: {
					'event.room_id': roomId,
					'event.type': EventType.MEMBER,
					'event.state_key': senderId,
					'event.content.membership': 'join',
				},
				sort: { 'event.origin_server_ts': -1 },
				limit: 1,
			},
		};

		switch (eventType) {
			case EventType.NAME:
				return [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];

			case EventType.MESSAGE:
				return [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];

			case EventType.REACTION:
				return [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];

			case EventType.MEMBER:
				return [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];

			case EventType.CREATE:
				return [baseQueries.create];

			case EventType.POWER_LEVELS:
				return [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];

			case EventType.REDACTION:
				return [baseQueries.create, baseQueries.powerLevels];

			default:
				throw new Error(`Unsupported event type: ${eventType}`);
		}
	}

	async checkUserPermission(
		powerLevelsEventId: string,
		userId: string,
		actionType: EventType,
	): Promise<boolean> {
		const powerLevelsEvent =
			await this.eventRepository.findById(powerLevelsEventId);
		if (!powerLevelsEvent) {
			this.logger.warn(`Power levels event ${powerLevelsEventId} not found`);
			return false;
		}

		const powerLevelsContent = powerLevelsEvent.event
			.content as RoomPowerLevelsEvent['content'];
		const userPowerLevel =
			powerLevelsContent.users?.[userId] ??
			powerLevelsContent.users_default ??
			0;

		let requiredPowerLevel = powerLevelsContent.events?.[actionType];
		if (requiredPowerLevel === undefined) {
			requiredPowerLevel = powerLevelsContent.events_default ?? 0;
		}

		this.logger.debug(
			`Permission check for ${userId} to send ${actionType}: UserLevel=${userPowerLevel}, RequiredLevel=${requiredPowerLevel}`,
		);
		return userPowerLevel >= requiredPowerLevel;
	}
}
