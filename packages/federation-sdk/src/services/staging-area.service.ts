import type {
	EventBase,
	EventStagingStore,
	Membership,
} from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import {
	MessageType,
	createLogger,
	isRedactedEvent,
} from '@rocket.chat/federation-core';
import {
	PduPowerLevelsEventContent,
	PersistentEventFactory,
	RoomState,
} from '@rocket.chat/federation-room';
import type { EventID, Pdu, RoomVersion } from '@rocket.chat/federation-room';
import { EventAuthorizationService } from './event-authorization.service';
import { EventEmitterService } from './event-emitter.service';
import { EventService } from './event.service';

import { LockRepository } from '../repositories/lock.repository';
import { ConfigService } from './config.service';
import { FederationService } from './federation.service';
import { MissingEventService } from './missing-event.service';
import { PartialStateResolutionError, StateService } from './state.service';

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

	async processEventForRoom(roomId: string) {
		const roomIdToRoomVersion = new Map<string, RoomVersion>();
		const getRoomVersion = async (roomId: string) => {
			if (roomIdToRoomVersion.has(roomId)) {
				return roomIdToRoomVersion.get(roomId) as RoomVersion;
			}

			const version = await this.stateService.getRoomVersion(roomId);
			roomIdToRoomVersion.set(roomId, version);
			return version;
		};

		const toEventBase = async (pdu: Pdu) => {
			const version = await getRoomVersion(pdu.room_id);
			return PersistentEventFactory.createFromRawEvent(pdu, version);
		};

		let event: EventStagingStore | null = null;

		do {
			event = await this.eventService.getLeastDepthEventForRoom(roomId);
			if (!event) {
				this.logger.debug({ msg: 'No staged event found for room', roomId });
				break;
			}

			if (event.got > MAX_EVENT_RETRY) {
				this.logger.warn(
					`Event ${event._id} has been tried ${MAX_EVENT_RETRY} times, removing from staging area`,
				);
				await this.eventService.markEventAsUnstaged(event);
				continue;
			}

			this.logger.info({ msg: 'Processing event', eventId: event._id });

			// if we got an event, we need to update the lock's timestamp to avoid it being timed out
			// and acquired by another instance while we're processing a batch of events for this room
			await this.lockRepository.updateLockTimestamp(
				roomId,
				this.configService.instanceId,
			);

			try {
				const addedMissing = await this.processDependencyStage(event);
				if (addedMissing) {
					// if we added missing events, we postpone the processing of this event
					// to give time for the missing events to be processed first
					throw new MissingEventsError('Added missing events');
				}

				if ('from' in event && event.from !== 'join') {
					await this.processAuthorizationStage(event);
				}
				await this.stateService.handlePdu(await toEventBase(event.event));
				await this.processNotificationStage(event);

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
		await this.lockRepository.releaseLock(
			roomId,
			this.configService.instanceId,
		);
	}

	private async processDependencyStage(event: EventStagingStore) {
		const eventId = event._id;

		const [authEvents, prevEvents] = this.extractEventsFromIncomingPDU(
			event.event,
		);

		const eventIds = [...authEvents, ...prevEvents];
		this.logger.debug(
			`Checking dependencies for event ${eventId}: ${eventIds.length} references`,
		);

		const { missing } = await this.eventService.checkIfEventsExists(
			eventIds.flat(),
		);

		if (missing.length === 0) {
			return false;
		}
		this.logger.debug(
			`Missing ${missing.length} events for ${eventId}: ${missing}`,
		);

		const latestEvent = await this.eventService.getLastEventForRoom(
			event.event.room_id,
		);

		let addedMissing = false;

		if (latestEvent) {
			this.logger.debug(
				`Fetching missing events between ${latestEvent._id} and ${eventId} for room ${event.event.room_id}`,
			);

			const missingEvents = await this.federationService.getMissingEvents(
				event.origin,
				event.event.room_id,
				[latestEvent._id],
				[eventId],
				10,
				0,
			);

			this.logger.debug(
				`Persisting ${missingEvents.events.length} fetched missing events`,
			);

			await this.eventService.processIncomingPDUs(
				event.origin,
				missingEvents.events,
			);

			addedMissing = missingEvents.events.length > 0;
		} else {
			const found = await Promise.all(
				missing.map((missingId) => {
					this.logger.debug(
						`Adding missing event ${missingId} to missing events service`,
					);

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

	private async processAuthorizationStage(event: EventStagingStore) {
		this.logger.debug(`Authorizing event ${event._id}`);
		const authEvents = await this.eventService.getAuthEventIds(
			event.event.type,
			{ roomId: event.event.room_id, senderId: event.event.sender },
		);

		const isAuthorized = await this.eventAuthService.authorizeEvent(
			event.event,
			authEvents.map((e) => e.event),
		);

		if (!isAuthorized) {
			throw new Error('event authorization failed');
		}
	}

	private async processNotificationStage(event: EventStagingStore) {
		this.logger.debug(`Notifying clients about event ${event._id}`);

		const {
			_id: eventId,
			event: { room_id: roomId },
		} = event;

		switch (true) {
			case event.event.type === 'm.room.message':
				this.eventEmitterService.emit('homeserver.matrix.message', {
					event_id: eventId,
					event: event.event,
					room_id: roomId,
					sender: event.event.sender,
					origin_server_ts: event.event.origin_server_ts,
					content: {
						...event.event.content,
						body: event.event.content?.body as string,
						msgtype: event.event.content?.msgtype as MessageType,
						'm.relates_to': event.event.content?.['m.relates_to'] as
							| {
									rel_type: 'm.replace';
									event_id: EventID;
							  }
							| {
									rel_type: 'm.annotation';
									event_id: EventID;
									key: string;
							  }
							| {
									rel_type: 'm.thread';
									event_id: EventID;
							  },
						'm.new_content': event.event.content?.['m.new_content'] as {
							body: string;
							msgtype: MessageType;
						},
						formatted_body: (event.event.content?.formatted_body ||
							'') as string,
					},
				});
				break;
			case event.event.type === 'm.room.encryption':
				this.eventEmitterService.emit('homeserver.matrix.encryption', {
					event_id: eventId,
					event: event.event,
					room_id: roomId,
					sender: event.event.sender,
					origin_server_ts: event.event.origin_server_ts,
				});
				break;
			case event.event.type === 'm.room.encrypted':
				this.eventEmitterService.emit('homeserver.matrix.encrypted', {
					event_id: eventId,
					event: event.event,
					room_id: roomId,
					sender: event.event.sender,
					origin_server_ts: event.event.origin_server_ts,
					content: {
						...event.event.content,
						'm.relates_to': event.event.content?.['m.relates_to'] as
							| {
									rel_type: 'm.replace';
									event_id: EventID;
							  }
							| {
									rel_type: 'm.annotation';
									event_id: EventID;
									key: string;
							  }
							| {
									rel_type: 'm.thread';
									event_id: EventID;
							  },
					},
				});
				break;
			case event.event.type === 'm.reaction': {
				this.eventEmitterService.emit('homeserver.matrix.reaction', {
					event_id: eventId,
					event: event.event,
					room_id: roomId,
					sender: event.event.sender,
					origin_server_ts: event.event.origin_server_ts,
					content: event.event.content as {
						'm.relates_to': {
							rel_type: 'm.annotation';
							event_id: EventID;
							key: string;
						};
					},
				});
				break;
			}
			case isRedactedEvent(event.event): {
				this.eventEmitterService.emit('homeserver.matrix.redaction', {
					event_id: eventId,
					event: event.event,
					room_id: roomId,
					sender: event.event.sender,
					origin_server_ts: event.event.origin_server_ts,
					redacts: event.event.redacts,
					content: {
						reason: event.event.content?.reason,
					},
				});
				break;
			}
			case event.event.type === 'm.room.member': {
				this.eventEmitterService.emit('homeserver.matrix.membership', {
					event_id: eventId,
					event: event.event,
					room_id: roomId,
					sender: event.event.sender,
					state_key: event.event.state_key,
					origin_server_ts: event.event.origin_server_ts,
					content: event.event.content,
				});
				break;
			}
			case event.event.type === 'm.room.name': {
				this.eventEmitterService.emit('homeserver.matrix.room.name', {
					event_id: eventId,
					event: event.event,
					room_id: roomId,
					user_id: event.event.sender,
					name: event.event.content?.name as string,
				});
				break;
			}
			case event.event.type === 'm.room.topic': {
				this.eventEmitterService.emit('homeserver.matrix.room.topic', {
					event_id: eventId,
					event: event.event,
					room_id: roomId,
					user_id: event.event.sender,
					topic: event.event.content.topic,
				});
				break;
			}
			case event.event.type === 'm.room.server_acl': {
				this.eventEmitterService.emit('homeserver.matrix.room.server_acl', {
					event_id: eventId,
					event: event.event,
				});
				break;
			}
			case event.event.type === 'm.room.power_levels': {
				this.eventEmitterService.emit('homeserver.matrix.room.power_levels', {
					event_id: eventId,
					event: event.event,
				});
				const getRole = (powerLevel: number) => {
					if (powerLevel === 100) {
						return 'owner';
					}
					if (powerLevel === 50) {
						return 'moderator';
					}

					return 'user';
				};

				const plEvent = await this.stateService.getEvent(eventId);
				if (!plEvent) {
					throw new Error(`Power level event ${eventId} not found in db`);
				}

				// at this point we potentially have the new power level event
				const oldRoomState = new RoomState(
					await this.stateService.getStateBeforeEvent(plEvent),
				);

				const oldPowerLevels = oldRoomState.powerLevels?.users;

				const changedUserPowers = (
					event.event.content as PduPowerLevelsEventContent
				).users;

				if (!changedUserPowers) {
					this.logger.debug('No changed user powers, resetting all powers');
					// everyone set to "user" except for the owner
					const owner = oldRoomState.creator;
					if (!oldPowerLevels) {
						this.logger.debug('No current power levels, skipping');
						break;
					}

					for (const userId of Object.keys(oldPowerLevels)) {
						if (userId === owner) {
							continue;
						}

						this.logger.debug(`Resetting power level for ${userId} to user`);

						this.eventEmitterService.emit('homeserver.matrix.room.role', {
							sender_id: event.event.sender,
							user_id: userId,
							room_id: roomId,
							role: 'user', // since new power level reset all powers
						});
					}
				} else {
					this.logger.debug('Changed user powers, emitting events');
					if (!oldPowerLevels) {
						this.logger.debug('No current power levels, setting new ones');
						// no existing, set the new ones
						for (const [userId, power] of Object.entries(changedUserPowers)) {
							this.logger.debug(
								`Setting power level for ${userId} to ${power}`,
							);
							this.eventEmitterService.emit('homeserver.matrix.room.role', {
								sender_id: event.event.sender,
								user_id: userId,
								room_id: roomId,
								role: getRole(power),
							});
						}

						break;
					}
					// need to know what changed
					const usersInOldPowerLevelEvent = Object.keys(oldPowerLevels);
					const usersInNewPowerLevelEvent = Object.keys(changedUserPowers);

					const setOrUnsetPowerLevels = new Set(
						usersInNewPowerLevelEvent,
					).difference(new Set(usersInOldPowerLevelEvent));

					this.logger.debug(
						{
							difference: Array.from(setOrUnsetPowerLevels),
						},
						'Strong difference in power levels',
					);

					// for the difference only new power level content matters
					for (const userId of setOrUnsetPowerLevels) {
						const newPowerLevel = changedUserPowers[userId]; // if unset, it's 0, if set, it's the power level
						this.logger.debug(
							`Emitting event for ${userId} with new power level ${newPowerLevel ?? 0}`,
						);
						this.eventEmitterService.emit('homeserver.matrix.room.role', {
							sender_id: event.event.sender,
							user_id: userId,
							room_id: roomId,
							role: getRole(newPowerLevel),
						});
					}

					this.logger.debug('Emitting events for changed user powers');

					// now use the new content
					for (const [userId, power] of Object.entries(changedUserPowers)) {
						if (
							power === oldPowerLevels[userId] || // no change
							setOrUnsetPowerLevels.has(userId) // already handled
						) {
							continue;
						}

						this.logger.debug(
							`Emitting event for ${userId} with power level ${power}`,
						);

						this.eventEmitterService.emit('homeserver.matrix.room.role', {
							sender_id: event.event.sender,
							user_id: userId,
							room_id: roomId,
							role: getRole(power),
						});
					}
				}

				break;
			}
			default:
				this.logger.warn(
					`Unknown event type: ${event.event.type} for emitterService for now`,
				);
				break;
		}
	}
}
