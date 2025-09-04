import type {
	BaseEDU,
	HashedEvent,
	PresenceEDU,
	RoomPowerLevelsEvent,
	SignedJson,
	TypingEDU,
} from '@hs/core';
import { isPresenceEDU, isTypingEDU } from '@hs/core';
import type { RedactionEvent } from '@hs/core';
import { generateId } from '@hs/core';
import { MatrixError } from '@hs/core';
import type { EventBase, EventStore } from '@hs/core';
import {
	getPublicKeyFromRemoteServer,
	makeGetPublicKeyFromServerProcedure,
} from '@hs/core';
import { pruneEventDict } from '@hs/core';

import { checkSignAndHashes } from '@hs/core';
import { createLogger } from '@hs/core';
import {
	type Pdu,
	type PduForType,
	type PduType,
	PersistentEventFactory,
} from '@hs/room';
import { singleton } from 'tsyringe';
import type { z } from 'zod';
import { StagingAreaQueue } from '../queues/staging-area.queue';
import { EventRepository } from '../repositories/event.repository';
import { KeyRepository } from '../repositories/key.repository';
import { RoomRepository } from '../repositories/room.repository';
import { eventSchemas } from '../utils/event-schemas';
import { ConfigService } from './config.service';
import { EventEmitterService } from './event-emitter.service';
import { StateService } from './state.service';

type ValidationResult = {
	eventId: string;
	event: Pdu;
	valid: boolean;
	error?: {
		errcode: string;
		error: string;
	};
};
export interface AuthEventParams {
	roomId: string;
	senderId: string;
}

@singleton()
export class EventService {
	private readonly logger = createLogger('EventService');

	private currentTransactions = new Set<string>();

	constructor(
		private readonly eventRepository: EventRepository,
		private readonly roomRepository: RoomRepository,
		private readonly keyRepository: KeyRepository,
		private readonly configService: ConfigService,

		private readonly stagingAreaQueue: StagingAreaQueue,
		private readonly stateService: StateService,

		private readonly eventEmitterService: EventEmitterService,
	) {}

	async getEventById<T extends PduType, P extends EventStore<PduForType<T>>>(
		eventId: string,
		type?: T,
	): Promise<P | null> {
		if (type) {
			return (this.eventRepository.findByRoomIdAndType(eventId, type) ??
				null) as Promise<P>;
		}
		return (this.eventRepository.findById(eventId) ?? null) as Promise<P>;
	}

	async checkIfEventsExists(
		eventIds: string[],
	): Promise<{ missing: string[]; found: string[] }> {
		const eventsCursor = this.eventRepository.findByIds(eventIds);
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
	async storeEventAsStaged(
		stagedEvent: Pick<EventStore, '_id' | 'event' | 'missing_dependencies'>,
	): Promise<void> {
		try {
			// First check if the event already exists to avoid duplicates
			const existingEvent = await this.eventRepository.findById(
				stagedEvent._id,
			);
			if (existingEvent) {
				// If it already exists as a regular event (not staged), nothing to do
				if (!existingEvent.staged) {
					this.logger.debug(
						`Event ${stagedEvent._id} already exists as a regular event, nothing to stage`,
					);
					return;
				}

				// TODO: Remove unneeded db roundtrips by removing upsert or creatingStaged
				// Update the staged event with potentially new dependencies info
				await this.eventRepository.upsert(stagedEvent.event);
				// Make a separate update for metadata since upsert only handles the event data
				// We do this by using the createStaged method, which should update if exists
				await this.eventRepository.createStaged(stagedEvent.event);
				this.logger.debug(
					`Updated staged event ${stagedEvent._id} with ${stagedEvent.missing_dependencies?.length} missing dependencies`,
				);
			} else {
				await this.eventRepository.createStaged(stagedEvent.event);

				this.logger.debug(
					`Stored new staged event ${stagedEvent._id} with ${stagedEvent.missing_dependencies?.length} missing dependencies`,
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
				this.eventRepository.findStagedEventsByDependencyId(dependencyId);

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

	async processIncomingTransaction({
		origin,
		pdus,
		edus,
	}: { origin: string; pdus: Pdu[]; edus?: BaseEDU[] }): Promise<void> {
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

		this.currentTransactions.add(origin);

		if (totalPdus > 0) {
			await this.processIncomingPDUs(pdus);
		}

		if (edus && totalEdus > 0) {
			await this.processIncomingEDUs(edus);
		}

		this.currentTransactions.delete(origin);
	}

	private async processIncomingPDUs(pdus: Pdu[]): Promise<void> {
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
				// TODO: check what to do with origin
				origin: event.event.sender.split(':')[1],
				event: event.event,
			});
		}
	}

	private async processIncomingEDUs(edus: BaseEDU[]): Promise<void> {
		this.logger.debug(`Processing ${edus.length} incoming EDUs`);

		for (const edu of edus) {
			try {
				await this.processEDU(edu);
			} catch (error) {
				this.logger.error(
					`Error processing EDU of type ${edu.edu_type}: ${error instanceof Error ? error.message : String(error)}`,
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

	private async validateEventFormat(
		eventId: string,
		event: Pdu,
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
		event: Pdu,
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
				`Error in type-specific validation for ${eventId}: ${error.message || String(error)}`,
			);
			return {
				eventId,
				event,
				valid: false,
				error: {
					errcode: 'M_TYPE_VALIDATION_ERROR',
					error: `Error in type-specific validation: ${error.message || String(error)}`,
				},
			};
		}
	}

	private async validateSignaturesAndHashes(
		eventId: string,
		event: Pdu,
	): Promise<ValidationResult> {
		try {
			const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
				(origin, keyId) =>
					this.keyRepository.getValidPublicKeyFromLocal(origin, keyId),
				(origin, key) =>
					getPublicKeyFromRemoteServer(
						origin,
						this.configService.serverName,
						key,
					),
				(origin, keyId, publicKey) =>
					this.keyRepository.storePublicKey(origin, keyId, publicKey),
			);

			const origin = event.sender.split(':')[1];
			await checkSignAndHashes(event, origin, getPublicKeyFromServer);
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

	private async getRoomVersion(event: Pdu) {
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
		event: Pdu,
		eventId?: string,
		args?: object,
	): Promise<string> {
		// @ts-ignore: I am not using this code, ts-ignore to avoid ci problems for now
		return this.eventRepository.create(event, eventId || '', args);
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
		earliestEvents: string[],
		latestEvents: string[],
		limit: number,
	): Promise<{ events: { _id: string; event: Pdu }[] }> {
		// TODO: This would benefit from adding projections to the query
		const eventsCursor = this.eventRepository.findByRoomIdExcludingEventIds(
			roomId,
			[...earliestEvents, ...latestEvents],
			limit,
		);
		const events = await eventsCursor.toArray();

		return {
			events,
		};
	}

	async getEventsByIds(
		eventIds: string[],
	): Promise<{ _id: string; event: Pdu }[]> {
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
					'm.room.create',
					'm.room.member',
					'm.room.message',
					'm.room.redaction',
					'm.reaction',
					'm.room.name',
					'm.room.power_levels',
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
		powerLevelsEventId: string,
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
}
