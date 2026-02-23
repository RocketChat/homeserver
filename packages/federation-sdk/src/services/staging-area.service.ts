import type { EventBase, EventStagingStore, Membership } from '@rocket.chat/federation-core';
import { MessageType, createLogger, isRedactedEvent } from '@rocket.chat/federation-core';
import { PduPowerLevelsEventContent, PersistentEventFactory, RoomState } from '@rocket.chat/federation-room';
import type { Pdu, RoomID, RoomVersion } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { EventAuthorizationService } from './event-authorization.service';
import { EventEmitterService } from './event-emitter.service';
import { EventService } from './event.service';
import { FederationService } from './federation.service';
import { MissingEventService } from './missing-event.service';
import { PartialStateResolutionError, StateService } from './state.service';
import { LockRepository } from '../repositories/lock.repository';

const MAX_EVENT_RETRY =
	((maxRetry?: string) => {
		if (!maxRetry) return;

		const n = Number.parseInt(maxRetry, 10);
		if (!Number.isNaN(n) && n >= 0) {
			return n;
		}

		throw new Error('Invalid MAX_EVENT_RETRY value');
	})(process.env.MAX_EVENT_RETRY) ?? 10;

class MissingAuthorizationEventsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MissingAuthorizationEventsError';
	}
}

class MissingEventsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MissingEventsError';
	}
}

@singleton()
export class StagingAreaService {
	private readonly logger = createLogger('StagingAreaService');

	constructor(
		private readonly configService: ConfigService,
		private readonly eventService: EventService,
		private readonly missingEventsService: MissingEventService,
		private readonly eventAuthService: EventAuthorizationService,
		private readonly eventEmitterService: EventEmitterService,
		private readonly stateService: StateService,
		private readonly federationService: FederationService,
		private readonly lockRepository: LockRepository,
	) {}

	extractEventsFromIncomingPDU(pdu: EventBase) {
		const authEvents = pdu.auth_events || [];
		const prevEvents = pdu.prev_events || [];
		return [authEvents, prevEvents];
	}

	async processEventForRoom(roomId: RoomID) {
		const roomIdToRoomVersion = new Map<string, RoomVersion>();
		const getRoomVersion = async (roomId: RoomID) => {
			const version = roomIdToRoomVersion.get(roomId) ?? (await this.stateService.getRoomVersion(roomId));
			roomIdToRoomVersion.set(roomId, version);
			return version;
		};

		const toEventBase = async (pdu: Pdu) => {
			const version = await getRoomVersion(pdu.room_id);
			return PersistentEventFactory.createFromRawEvent(pdu, version);
		};

		let event: EventStagingStore | null = null;

		do {
			// eslint-disable-next-line no-await-in-loop
			event = await this.eventService.getLeastDepthEventForRoom(roomId);
			if (!event) {
				this.logger.debug({ msg: 'No staged event found for room', roomId });
				break;
			}

			if (event.got > MAX_EVENT_RETRY) {
				this.logger.warn(`Event ${event._id} has been tried ${MAX_EVENT_RETRY} times, removing from staging area`);
				// eslint-disable-next-line no-await-in-loop
				await this.eventService.markEventAsUnstaged(event);
				continue;
			}

			this.logger.info({ msg: 'Processing event', eventId: event._id });

			// if we got an event, we need to update the lock's timestamp to avoid it being timed out
			// and acquired by another instance while we're processing a batch of events for this room
			// eslint-disable-next-line no-await-in-loop
			await this.lockRepository.updateLockTimestamp(roomId, this.configService.instanceId);

			try {
				// eslint-disable-next-line no-await-in-loop
				const addedMissing = await this.processDependencyStage(event);
				if (addedMissing) {
					// if we added missing events, we postpone the processing of this event
					// to give time for the missing events to be processed first
					throw new MissingEventsError('Added missing events');
				}

				// eslint-disable-next-line no-await-in-loop
				await this.stateService.handlePdu(await toEventBase(event.event));
				// eslint-disable-next-line no-await-in-loop
				await this.eventService.notify({
					eventId: event._id,
					event: event.event,
				});
				// eslint-disable-next-line no-await-in-loop
				await this.eventService.markEventAsUnstaged(event);

				// TODO add missing logic from synapse: Prune the event queue if it's getting large.
			} catch (err: unknown) {
				if (err instanceof MissingAuthorizationEventsError) {
					this.logger.info({
						msg: 'Missing events, postponing event processing',
						eventId: event._id,
						err,
					});
				} else if (err instanceof PartialStateResolutionError) {
					this.logger.info({
						msg: 'Still joining room, postponing event processing',
						eventId: event._id,
						err,
					});
				} else if (err instanceof MissingEventsError) {
					this.logger.info({
						msg: 'Added missing events, postponing event processing',
						eventId: event._id,
					});
				} else {
					this.logger.error({
						msg: 'Error processing event, postponing event processing',
						event,
						err,
					});
				}
			}
		} while (event);

		// release the lock after processing
		await this.lockRepository.releaseLock(roomId, this.configService.instanceId);
	}

	private async processDependencyStage(event: EventStagingStore) {
		const eventId = event._id;

		const [authEvents, prevEvents] = this.extractEventsFromIncomingPDU(event.event);

		const eventIds = [...authEvents, ...prevEvents];
		this.logger.debug(`Checking dependencies for event ${eventId}: ${eventIds.length} references`);

		const { missing } = await this.eventService.checkIfEventsExists(eventIds.flat());

		if (missing.length === 0) {
			return false;
		}
		this.logger.debug(`Missing ${missing.length} events for ${eventId}: ${missing}`);

		const latestEvent = await this.eventService.getLastEventForRoom(event.event.room_id);

		let addedMissing = false;

		if (latestEvent) {
			this.logger.debug(`Fetching missing events between ${latestEvent._id} and ${eventId} for room ${event.event.room_id}`);

			const missingEvents = await this.federationService.getMissingEvents(
				event.origin,
				event.event.room_id,
				[latestEvent._id],
				[eventId],
				10,
				0,
			);

			this.logger.debug(`Persisting ${missingEvents.events.length} fetched missing events`);

			await this.eventService.processIncomingPDUs(event.origin, missingEvents.events);

			addedMissing = missingEvents.events.length > 0;
		} else {
			const found = await Promise.all(
				missing.map((missingId) => {
					this.logger.debug(`Adding missing event ${missingId} to missing events service`);

					return this.missingEventsService.fetchMissingEvent({
						eventId: missingId,
						roomId: event.event.room_id,
						origin: event.origin,
					});
				}),
			);

			addedMissing = found.some((f) => f === true);
		}

		// if the auth events are missing, the authorization stage will fail anyway,
		// so to save some time we throw an error here, and the event processing will be postponed
		if (addedMissing && authEvents.some((e) => missing.includes(e))) {
			throw new MissingAuthorizationEventsError('Missing authorization events');
		}

		return addedMissing;
	}
}
