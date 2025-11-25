import type {
	BaseEDU,
	EventStagingStore,
	PresenceEDU,
	RoomPowerLevelsEvent,
	TypingEDU,
} from '@rocket.chat/federation-core';
import { isPresenceEDU, isTypingEDU } from '@rocket.chat/federation-core';
import type { RedactionEvent } from '@rocket.chat/federation-core';
import { generateId } from '@rocket.chat/federation-core';
import type { EventStore } from '@rocket.chat/federation-core';
import { pruneEventDict } from '@rocket.chat/federation-core';

import { checkSignAndHashes } from '@rocket.chat/federation-core';
import { createLogger } from '@rocket.chat/federation-core';
import {
	type EventID,
	type Pdu,
	type PduForType,
	type PduType,
	PersistentEventFactory,
	RoomID,
	RoomVersion,
	getAuthChain,
} from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';
import type { z } from 'zod';
import { StagingAreaQueue } from '../queues/staging-area.queue';
import { EventStagingRepository } from '../repositories/event-staging.repository';
import { EventRepository } from '../repositories/event.repository';
import { LockRepository } from '../repositories/lock.repository';
import { eventSchemas } from '../utils/event-schemas';
import { ConfigService } from './config.service';
import { EventEmitterService } from './event-emitter.service';
import { ServerService } from './server.service';
import { StateService } from './state.service';

export interface AuthEventParams {
	roomId: string;
	senderId: string;
}

@singleton()
export class EventService {
	private readonly logger = createLogger('EventService');

	private currentTransactions = new Set<string>();

	constructor(
		private readonly configService: ConfigService,
		private readonly stagingAreaQueue: StagingAreaQueue,
		private readonly stateService: StateService,
		private readonly serverService: ServerService,
		private readonly eventEmitterService: EventEmitterService,
		@inject(delay(() => EventRepository))
		private readonly eventRepository: EventRepository,
		@inject(delay(() => EventStagingRepository))
		private readonly eventStagingRepository: EventStagingRepository,
		@inject(delay(() => LockRepository))
		private readonly lockRepository: LockRepository,
	) {}

	async getEventById<T extends PduType, P extends EventStore<PduForType<T>>>(
		eventId: EventID,
		type?: T,
	): Promise<P | null> {
		if (type) {
			return (this.eventRepository.findByIdAndType(eventId, type) ??
				null) as Promise<P>;
		}
		return (this.eventRepository.findById(eventId) ?? null) as Promise<P>;
	}

	async checkIfEventsExists(
		eventIds: EventID[],
	): Promise<{ missing: EventID[]; found: EventID[] }> {
		// TODO, return only the IDs, not the full events
		const eventsCursor = this.eventRepository.findByIds(eventIds);
		const events = await eventsCursor.toArray();

		return eventIds.reduce(
			(acc: { missing: EventID[]; found: EventID[] }, id) => {
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

	async getLeastDepthEventForRoom(
		roomId: string,
	): Promise<EventStagingStore | null> {
		return this.eventStagingRepository.getLeastDepthEventForRoom(roomId);
	}

	/**
	 * Mark an event as no longer staged
	 */
	async markEventAsUnstaged(event: EventStagingStore): Promise<void> {
		await this.eventStagingRepository.removeByEventId(event._id);
	}

	async processIncomingTransaction({
		origin,
		pdus,
		edus,
	}: {
		origin: string;
		pdus: Pdu[];
		edus?: BaseEDU[];
	}): Promise<void> {
		if (!Array.isArray(pdus)) {
			throw new Error('pdus must be an array');
		}

		if (edus && !Array.isArray(edus)) {
			throw new Error('edus must be an array');
		}

		const totalPdus = pdus.length;
		const totalEdus = edus?.length || 0;

		if (totalPdus > 50 || totalEdus > 100) {
			throw new Error('too-many-events');
		}

		// only one current transaction per origin is allowed
		if (this.currentTransactions.has(origin)) {
			throw new Error('too-many-concurrent-transactions');
		}

		try {
			this.currentTransactions.add(origin);

			// process both PDU and EDU in "parallel" to no block EDUs due to heavy PDU operations
			await Promise.all([
				this.processIncomingPDUs(origin, pdus),
				edus && this.processIncomingEDUs(edus),
			]);
		} finally {
			this.currentTransactions.delete(origin);
		}
	}

	async processIncomingPDUs(origin: string, pdus: Pdu[]): Promise<void> {
		// organize events by room id
		const eventsByRoomId = new Map<string, Pdu[]>();
		for (const event of pdus) {
			const roomId = event.room_id;
			if (!eventsByRoomId.has(roomId)) {
				eventsByRoomId.set(roomId, []);
			}
			eventsByRoomId.get(roomId)?.push(event);
		}

		const roomIdToRoomVersionmap = new Map<string, RoomVersion>();
		const getRoomVersion = async (roomId: RoomID) => {
			if (roomIdToRoomVersionmap.has(roomId)) {
				return roomIdToRoomVersionmap.get(roomId) as RoomVersion;
			}

			const roomVersion = await this.getRoomVersion({ room_id: roomId });

			roomIdToRoomVersionmap.set(roomId, roomVersion);

			return roomVersion;
		};

		// process each room's events in parallel
		// TODO implement a concurrency limit
		await Promise.all(
			Array.from(eventsByRoomId.entries()).map(async ([roomId, events]) => {
				for await (const event of events) {
					try {
						await this.validateEvent(event);
					} catch (err) {
						this.logger.error({
							msg: 'Event validation failed',
							origin,
							event,
							err,
						});
						continue;
					}

					const roomVersion = await getRoomVersion(event.room_id);

					const pdu = PersistentEventFactory.createFromRawEvent(
						event,
						roomVersion,
					);

					const eventId = pdu.eventId;

					const existing = await this.eventRepository.findById(eventId);
					if (existing) {
						this.logger.info(
							`Ignoring received event ${eventId} which we have already seen`,
						);

						// TODO we may need to check if an event is an outlier and re-process it
						continue;
					}

					// save the event as staged to be processed
					await this.eventStagingRepository.create(eventId, origin, event);

					// acquire a lock for processing the event
					const lock = await this.lockRepository.getLock(
						roomId,
						this.configService.instanceId,
					);
					if (!lock) {
						this.logger.debug(`Couldn't acquire a lock for room ${roomId}`);
						continue;
					}

					// if we have a lock, we can process the event
					// void this.stagingAreaService.processEventForRoom(roomId);

					// TODO change this to call stagingAreaService directly (line above)
					this.stagingAreaQueue.enqueue(roomId);
				}
			}),
		);
	}

	private async validateEvent(event: Pdu): Promise<void> {
		const roomVersion = await this.getRoomVersion(event);
		if (!roomVersion) {
			throw new Error('M_UNKNOWN_ROOM_VERSION');
		}

		if (
			event.type === 'm.room.member' &&
			event.content.membership === 'invite' &&
			'third_party_invite' in event.content
		) {
			throw new Error('Third party invites are not supported');
		}

		const origin = event.sender.split(':').pop();
		if (!origin) {
			throw new Error('Event sender is missing domain');
		}

		const eventSchema = this.getEventSchema(roomVersion, event.type);

		const validationResult = eventSchema.safeParse(event);
		if (!validationResult.success) {
			const formattedErrors = JSON.stringify(validationResult.error.format());
			this.logger.error({
				msg: 'Event failed schema validation',
				formattedErrors,
			});

			throw new Error('M_SCHEMA_VALIDATION_FAILED');
		}

		const validateErrors = this.validateEventByType(event);
		if (validateErrors.length > 0) {
			this.logger.error({
				msg: 'Create event validation failed',
				errors: validateErrors,
			});

			throw new Error('M_INVALID_EVENT');
		}

		if (!event.hashes && !event.signatures) {
			throw new Error('M_MISSING_SIGNATURES_OR_HASHES');
		}

		await checkSignAndHashes(event, origin, (origin, key) => {
			return this.serverService.getPublicKey(origin, key);
		});
	}

	private async processIncomingEDUs(edus: BaseEDU[]): Promise<void> {
		this.logger.debug(`Processing ${edus.length} incoming EDUs`);

		for (const edu of edus) {
			try {
				await this.processEDU(edu);
			} catch (error) {
				this.logger.error({
					msg: 'Error processing incoming EDU',
					edu,
					err: error,
				});
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
				`Processing presence update for ${presenceUpdate.user_id}: ${presenceUpdate.presence}${
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

	private validateEventByType(event: Pdu): string[] {
		const errors: string[] = [];

		if (event.type !== 'm.room.create') {
			if (
				!event.prev_events ||
				!Array.isArray(event.prev_events) ||
				event.prev_events.length === 0
			) {
				errors.push('Event must reference previous events (prev_events)');
			}

			// checks it doesn't have an excessive number of prev_events or auth_events,
			// which could cause a huge state resolution or cascade of event fetches
			// https://github.com/element-hq/synapse/blob/19fe3f001ed0aff5a5f136e440ae53c04340be88/synapse/handlers/federation_event.py#L2359
			if (event.prev_events.length > 20) {
				errors.push('Event must not have more than 20 prev_events');
			}
			if (event.auth_events.length > 10) {
				errors.push('Event must not have more than 10 auth_events');
			}
		} else {
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
				if (
					typeof event.content.room_version !== 'string' ||
					!validRoomVersions.includes(event.content.room_version)
				) {
					errors.push(
						`Unsupported room version: ${event.content.room_version}`,
					);
				}
			}
		}

		return errors;
	}

	private extractDomain(id: string): string {
		const parts = id.split(':');
		return parts.length > 1 ? parts[1] : '';
	}

	private async getRoomVersion(event: Pick<Pdu, 'room_id'>) {
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

	async getLastEventForRoom(roomId: string): Promise<EventStore | null> {
		return this.eventRepository.findLatestFromRoomId(roomId);
	}

	async getCreateEventForRoom(roomId: string): Promise<Pdu | null> {
		const createEvent = await this.eventRepository.findByRoomIdAndType(
			roomId,
			'm.room.create',
		);
		return createEvent?.event ?? null;
	}

	async getMissingEvents(
		roomId: string,
		earliestEventsId: EventID[],
		latestEventsId: EventID[],
		limit = 10,
		minDepth = 0,
	): Promise<{ events: Pdu[] }> {
		const latestEventsData = await this.eventRepository
			.findEventsByIdsWithDepth(roomId, latestEventsId)
			.map((e) => e.event.depth)
			.toArray();

		const maxDepth = Math.min(...latestEventsData);

		const events = await this.eventRepository
			.findEventsByRoomAndDepth(
				roomId,
				minDepth,
				maxDepth,
				[...earliestEventsId, ...latestEventsId],
				limit,
			)
			.map((e) => e.event)
			.toArray();

		return { events };
	}

	async getEventsByIds(
		eventIds: EventID[],
	): Promise<{ _id: EventID; event: Pdu }[]> {
		if (!eventIds || eventIds.length === 0) {
			return [];
		}

		this.logger.debug(`Retrieving ${eventIds.length} events by IDs`);
		// TODO: This would benefit from adding projections to the query
		const events = await this.eventRepository.findByIds(eventIds).toArray();
		return events.map((event) => ({
			_id: event._id,
			event: event.event,
		}));
	}

	/**
	 * Find an invite event for a specific user in a specific room
	 */
	findInviteEvent(roomId: string, userId: string): Promise<EventStore | null> {
		return this.eventRepository.findInviteEventsByRoomIdAndUserId(
			roomId,
			userId,
		);
	}

	async getAuthEventIds(
		eventType: PduType,
		params: AuthEventParams,
	): Promise<EventStore[]> {
		const authEventsCursor = this.eventRepository.findAuthEvents(
			eventType,
			params.roomId,
			params.senderId,
		);
		const authEvents: EventStore[] = [];

		for await (const storeEvent of authEventsCursor) {
			const { type } = storeEvent.event;

			// TODO: check if those are the only valid auth events or the only current implemented
			if (
				type &&
				[
					'm.reaction',
					'm.room.create',
					'm.room.member',
					'm.room.message',
					'm.room.redaction',
					'm.room.name',
					'm.room.power_levels',
					'm.room.topic',
				].includes(type)
			) {
				authEvents.push(storeEvent);
			} else {
				this.logger.warn(
					`EventStore with id ${storeEvent._id} has an unrecognized event type: ${storeEvent.event?.type}`,
				);
			}
		}

		return authEvents;
	}

	async processRedaction(redactionEvent: RedactionEvent): Promise<void> {
		const eventIdToRedact = redactionEvent.redacts;
		if (!eventIdToRedact) {
			this.logger.error(
				`[REDACTION] Event is missing 'redacts' field: ${generateId(redactionEvent)}`,
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

		await this.eventRepository.redactEvent(eventIdToRedact, {
			...redactedEventContent,
			room_id: eventToRedact.event.room_id,
			sender: eventToRedact.event.sender,
			// TODO: check what to do with origin
			// origin: eventToRedact.event.sender.split(':')[1],
			origin_server_ts: eventToRedact.event.origin_server_ts,
			depth: eventToRedact.event.depth,
			prev_events: eventToRedact.event.prev_events,
			auth_events: eventToRedact.event.auth_events,
		} as typeof eventToRedact.event);

		this.logger.info(`Successfully redacted event ${eventIdToRedact}`);
	}

	async checkUserPermission(
		powerLevelsEventId: EventID,
		userId: string,
		actionType: PduType,
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

	async processOldStagedEvents() {
		this.logger.info('Processing old staged events on startup');

		const rooms = await this.eventStagingRepository.getDistinctStagedRooms();
		if (rooms.length === 0) {
			this.logger.info('No old staged events found to process');
			return;
		}

		// shuffle the rooms to give a chance to other instances to process other rooms
		rooms.sort(() => Math.random() - 0.5);

		// not we try to process one room at a time
		for await (const roomId of rooms) {
			const lock = await this.lockRepository.getLock(
				roomId,
				this.configService.instanceId,
			);
			if (!lock) {
				this.logger.debug(`Couldn't acquire a lock for room ${roomId}`);
				continue;
			}

			// if we have a lock, we can process the event
			// void this.stagingAreaService.processEventForRoom(roomId);

			// TODO change this to call stagingAreaService directly (line above)
			this.stagingAreaQueue.enqueue(roomId);

			// wait a bit before processing the next room to also give a chance to other instances
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
	}

	async getStateIds(
		roomId: string,
		eventId: EventID,
	): Promise<{ pdu_ids: string[]; auth_chain_ids: string[] }> {
		try {
			// Ensure the event exists and belongs to the requested room
			const event = await this.stateService.getEvent(eventId);
			if (!event || event.roomId !== roomId) {
				throw new Error('M_NOT_FOUND');
			}

			const state = await this.stateService.getStateBeforeEvent(event);

			const pduIds: EventID[] = state
				.values()
				.map((e) => e.eventId)
				.toArray();
			const authChainIds = new Set<string>();

			// Get the event store
			const store = this.stateService._getStore(event.version);

			// Extract state event IDs and collect auth chain IDs
			for (const [, event] of state.entries()) {
				// Get the complete auth chain for this event
				try {
					const authChain = await getAuthChain(event, store);
					for (const authEventId of authChain) {
						authChainIds.add(authEventId);
					}
				} catch (error) {
					this.logger.warn({
						msg: `Failed to get auth chain for event ${event.eventId}:`,
						err: error,
					});
				}
			}

			return {
				pdu_ids: pduIds,
				auth_chain_ids: Array.from(authChainIds),
			};
		} catch (error) {
			this.logger.error({
				msg: `Failed to get state IDs for room ${roomId}:`,
				err: error,
			});
			throw error;
		}
	}

	async getState(
		roomId: string,
		eventId: EventID,
	): Promise<{
		pdus: Record<string, unknown>[];
		auth_chain: Record<string, unknown>[];
	}> {
		try {
			// Ensure the event exists and belongs to the requested room
			const event = await this.stateService.getEvent(eventId);
			if (!event || event.event.room_id !== roomId) {
				throw new Error('M_NOT_FOUND');
			}

			let state: Map<string, any>;

			// Get state at a specific event
			state = await this.stateService.getStateBeforeEvent(event);

			const pdus: Record<string, unknown>[] = [];
			const authChainIds = new Set<EventID>();

			// Get room version for the store
			const roomVersion = await this.stateService.getRoomVersion(roomId);
			if (!roomVersion) {
				throw new Error('Room version not found');
			}

			// Get the event store
			const store = this.stateService._getStore(roomVersion);
			// Extract state event objects and collect auth chain IDs
			for (const [, event] of state.entries()) {
				// PersistentEventBase has an event getter that contains the actual event data
				pdus.push(event.event);

				// Get the complete auth chain for this event
				try {
					const authChain = await getAuthChain(event, store);
					for (const authEventId of authChain) {
						authChainIds.add(authEventId);
					}
				} catch (error) {
					this.logger.warn({
						msg: `Failed to get auth chain for event ${event.eventId}:`,
						err: error,
					});
				}
			}

			// Fetch the actual auth event objects
			const authChain: Record<string, unknown>[] = [];
			if (authChainIds.size > 0) {
				try {
					const authEvents = await store.getEvents(Array.from(authChainIds));
					for (const authEvent of authEvents) {
						authChain.push(authEvent.event);
					}
				} catch (error) {
					this.logger.warn({
						msg: 'Failed to fetch auth event objects:',
						err: error,
					});
				}
			}

			return {
				pdus: pdus,
				auth_chain: authChain,
			};
		} catch (error) {
			this.logger.error({
				msg: `Failed to get state for room ${roomId}:`,
				err: error,
			});
			throw error;
		}
	}

	/**
	 * A transaction containing the PDUs that preceded the given event(s), including the given event(s), up to the given limit.
	 *
	 * Note: Though the PDU definitions require that prev_events and auth_events be limited in number, the response of backfill MUST NOT be validated on these specific restrictions.
	 *
	 * Due to historical reasons, it is possible that events which were previously accepted would now be rejected by these limitations. The events should be rejected per usual by the /send, /get_missing_events, and remaining endpoints.

	 */
	async getBackfillEvents(
		roomId: string,
		eventIds: EventID[],
		limit: number,
	): Promise<{
		origin: string;
		origin_server_ts: number;
		pdus: Array<Pdu>;
	}> {
		try {
			const parsedLimit = Math.min(Math.max(1, limit), 100);

			const newestRef = await this.eventRepository.findNewestEventForBackfill(
				roomId,
				eventIds,
			);
			if (!newestRef) {
				throw new Error('No newest event found');
			}

			const events = await this.eventRepository
				.findEventsForBackfill(
					roomId,
					newestRef.event.depth,
					newestRef.event.origin_server_ts,
					parsedLimit,
				)
				.toArray();

			const pdus = events.map((eventStore) => eventStore.event);

			return {
				origin: this.configService.serverName,
				origin_server_ts: Date.now(),
				pdus,
			};
		} catch (error) {
			this.logger.error({
				msg: `Failed to get backfill for room ${roomId}:`,
				err: error,
			});
			throw error;
		}
	}
}
