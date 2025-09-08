import type { EventBase, Membership } from '@hs/core';
import { singleton } from 'tsyringe';
import type { StagingAreaEventType } from '../queues/staging-area.queue';
import { StagingAreaQueue } from '../queues/staging-area.queue';

import { createLogger, isRedactedEvent } from '@hs/core';
import {
	Pdu,
	PduPowerLevelsEventContent,
	PersistentEventFactory,
} from '@hs/room';
import { Lock } from '../utils/lock.decorator';
import { EventAuthorizationService } from './event-authorization.service';
import { EventEmitterService } from './event-emitter.service';
import { EventStateService } from './event-state.service';
import { EventService } from './event.service';

import { MissingEventService } from './missing-event.service';
import { StateService } from './state.service';

// ProcessingState indicates where in the flow an event is
enum ProcessingState {
	PENDING_DEPENDENCIES = 'pending_dependencies',
	PENDING_AUTHORIZATION = 'pending_authorization',
	PENDING_STATE_RESOLUTION = 'pending_state_resolution',
	PENDING_PERSISTENCE = 'pending_persistence',
	PENDING_FEDERATION = 'pending_federation',
	PENDING_NOTIFICATION = 'pending_notification',
	COMPLETED = 'completed',
	REJECTED = 'rejected',
}

// ExtendedStagingEvent adds processing state to track event flow
interface ExtendedStagingEvent extends StagingAreaEventType {
	state: ProcessingState;
	error?: string;
	missingEvents?: string[];
	retryCount?: number;
}

@singleton()
export class StagingAreaService {
	private processingEvents = new Map<string, ExtendedStagingEvent>();
	private readonly logger = createLogger('StagingAreaService');

	constructor(
		private readonly eventService: EventService,
		private readonly missingEventsService: MissingEventService,
		private readonly stagingAreaQueue: StagingAreaQueue,
		private readonly eventAuthService: EventAuthorizationService,
		private readonly eventStateService: EventStateService,
		private readonly eventEmitterService: EventEmitterService,
		private readonly stateService: StateService,
	) {}

	addEventToQueue(event: StagingAreaEventType) {
		const extendedEvent: ExtendedStagingEvent = {
			...event,
			state: ProcessingState.PENDING_DEPENDENCIES,
			retryCount: 0,
		};

		this.processingEvents.set(event.eventId, extendedEvent);

		this.stagingAreaQueue.enqueue({
			...event,
			metadata: {
				state: ProcessingState.PENDING_DEPENDENCIES,
			},
		});

		this.logger.debug(`Added event ${event.eventId} to processing queue`);
	}

	extractEventsFromIncomingPDU(pdu: StagingAreaEventType) {
		const authEvents = pdu.event.auth_events || [];
		const prevEvents = pdu.event.prev_events || [];
		return [...authEvents, ...prevEvents];
	}

	// @Lock({ timeout: 10000, keyPath: 'event.room_id' })
	async processEvent(event: StagingAreaEventType & { metadata?: any }) {
		const eventId = event.eventId;
		const trackedEvent = this.processingEvents.get(eventId);

		if (!trackedEvent) {
			this.processingEvents.set(eventId, {
				...event,
				state: ProcessingState.PENDING_DEPENDENCIES,
				retryCount: 0,
			});
			await this.processDependencyStage(event);
			return;
		}

		const currentState = event.metadata?.state || trackedEvent.state;

		switch (currentState) {
			case ProcessingState.PENDING_DEPENDENCIES:
				await this.processDependencyStage(event);
				break;

			case ProcessingState.PENDING_AUTHORIZATION:
				await this.processAuthorizationStage(event);
				break;

			case ProcessingState.PENDING_STATE_RESOLUTION:
				await this.processStateResolutionStage(event);
				break;

			case ProcessingState.PENDING_PERSISTENCE:
				await this.processPersistenceStage(event);
				break;

			case ProcessingState.PENDING_FEDERATION:
				await this.processFederationStage(event);
				break;

			case ProcessingState.PENDING_NOTIFICATION:
				await this.processNotificationStage(event);
				break;

			case ProcessingState.COMPLETED:
				// Event is fully processed
				this.logger.debug(`Event ${eventId} fully processed`);
				this.processingEvents.delete(eventId);
				break;

			case ProcessingState.REJECTED:
				// Event was rejected, clean up
				this.logger.warn(
					`Event ${eventId} was rejected: ${trackedEvent.error}`,
				);
				this.processingEvents.delete(eventId);
				break;
		}
	}

	private async processDependencyStage(event: StagingAreaEventType) {
		const eventId = event.eventId;
		const trackedEvent = this.processingEvents.get(eventId);
		if (!trackedEvent) return;

		const eventIds = this.extractEventsFromIncomingPDU(event);
		this.logger.debug(
			`Checking dependencies for event ${eventId}: ${eventIds.length} references`,
		);

		const { missing } = await this.eventService.checkIfEventsExists(
			eventIds.flat(),
		);

		if (missing.length > 0) {
			this.logger.debug(`Missing ${missing.length} events for ${eventId}`);
			trackedEvent.missingEvents = missing;

			for (const missingId of missing) {
				this.logger.debug(
					`Adding missing event ${missingId} to missing events service`,
				);
				this.missingEventsService.addEvent({
					eventId: missingId,
					roomId: event.roomId,
					// TODO: check what to do with origin
					origin: event.origin,
				});
			}

			trackedEvent.retryCount = (trackedEvent.retryCount || 0) + 1;

			if (trackedEvent.retryCount < 5) {
				setTimeout(() => {
					this.stagingAreaQueue.enqueue({
						...event,
						metadata: {
							state: ProcessingState.PENDING_DEPENDENCIES,
						},
					});
				}, 1000 * trackedEvent.retryCount); // Exponential backoff
			} else {
				trackedEvent.state = ProcessingState.REJECTED;
				trackedEvent.error = `Failed to fetch dependencies after ${trackedEvent.retryCount} attempts`;
				this.processingEvents.set(eventId, trackedEvent);
			}
		} else {
			trackedEvent.state = ProcessingState.PENDING_AUTHORIZATION;
			this.processingEvents.set(eventId, trackedEvent);
			this.stagingAreaQueue.enqueue({
				...event,
				metadata: {
					state: ProcessingState.PENDING_AUTHORIZATION,
				},
			});
		}
	}

	private async processAuthorizationStage(event: StagingAreaEventType) {
		const eventId = event.eventId;
		const trackedEvent = this.processingEvents.get(eventId);
		if (!trackedEvent) return;

		try {
			this.logger.debug(`Authorizing event ${eventId}`);
			const authEvents = await this.eventService.getAuthEventIds(
				'm.room.message',
				{ roomId: event.roomId, senderId: event.event.sender },
			);

			const isAuthorized = await this.eventAuthService.authorizeEvent(
				event.event,
				authEvents.map((e) => e.event),
			);

			if (isAuthorized) {
				trackedEvent.state = ProcessingState.PENDING_STATE_RESOLUTION;
				this.processingEvents.set(eventId, trackedEvent);
				this.stagingAreaQueue.enqueue({
					...event,
					metadata: {
						state: ProcessingState.PENDING_STATE_RESOLUTION,
					},
				});
			} else {
				trackedEvent.state = ProcessingState.REJECTED;
				trackedEvent.error = 'Event failed authorization checks';
				this.processingEvents.set(eventId, trackedEvent);
			}
		} catch (error: any) {
			trackedEvent.state = ProcessingState.REJECTED;
			trackedEvent.error = `Authorization error: ${error?.message || String(error)}`;
			this.processingEvents.set(eventId, trackedEvent);
		}
	}

	private async processStateResolutionStage(event: StagingAreaEventType) {
		const eventId = event.eventId;
		const trackedEvent = this.processingEvents.get(eventId);
		if (!trackedEvent) return;

		try {
			this.logger.debug(`Resolving state for event ${eventId}`);
			const roomVersion = await this.stateService.getRoomVersion(event.roomId);
			if (!roomVersion) {
				throw new Error('processStateResolutionStage: Room version not found');
			}

			const pdu = PersistentEventFactory.createFromRawEvent(
				// TODO: refactor to StagingAreaEventType use Pdu
				event.event,
				roomVersion,
			);

			if (pdu.isState()) {
				await this.stateService.persistStateEvent(pdu);
				if (pdu.rejected) {
					throw new Error(pdu.rejectedReason);
				}
			} else {
				await this.stateService.persistTimelineEvent(pdu);
				if (pdu.rejected) {
					throw new Error(pdu.rejectedReason);
				}
			}

			trackedEvent.state = ProcessingState.PENDING_PERSISTENCE;
			this.processingEvents.set(eventId, trackedEvent);
			this.stagingAreaQueue.enqueue({
				...event,
				metadata: {
					state: ProcessingState.PENDING_PERSISTENCE,
				},
			});
		} catch (error: any) {
			trackedEvent.state = ProcessingState.REJECTED;
			trackedEvent.error = `State resolution error: ${error?.message || String(error)}`;
			this.processingEvents.set(eventId, trackedEvent);
		}
	}

	private async processPersistenceStage(event: StagingAreaEventType) {
		const eventId = event.eventId;
		const trackedEvent = this.processingEvents.get(eventId);
		if (!trackedEvent) return;

		try {
			this.logger.debug(`Persisting event ${eventId}`);
			// await this.eventService.insertEvent(event.event as any);
			console.log('Skipping persistence stage, persisted in previous stage'); // TODO: revisit

			trackedEvent.state = ProcessingState.PENDING_FEDERATION;
			this.processingEvents.set(eventId, trackedEvent);

			this.stagingAreaQueue.enqueue({
				...event,
				metadata: {
					state: ProcessingState.PENDING_FEDERATION,
				},
			});
		} catch (error: any) {
			trackedEvent.state = ProcessingState.REJECTED;
			trackedEvent.error = `Persistence error: ${error?.message || String(error)}`;
			this.processingEvents.set(eventId, trackedEvent);
		}
	}

	private async processFederationStage(event: StagingAreaEventType) {
		const eventId = event.eventId;
		const trackedEvent = this.processingEvents.get(eventId);
		if (!trackedEvent) return;

		try {
			this.logger.debug(`Federating event ${eventId}`);

			// Send event to other servers in the room
			// await this.federationService.sendEventToServers(event.roomId, event.event);

			trackedEvent.state = ProcessingState.PENDING_NOTIFICATION;
			this.processingEvents.set(eventId, trackedEvent);
			this.stagingAreaQueue.enqueue({
				...event,
				metadata: {
					state: ProcessingState.PENDING_NOTIFICATION,
				},
			});
		} catch (error: any) {
			this.logger.warn(
				`Federation error for ${eventId}: ${error?.message || String(error)}`,
			);

			trackedEvent.state = ProcessingState.PENDING_NOTIFICATION;
			this.processingEvents.set(eventId, trackedEvent);

			this.stagingAreaQueue.enqueue({
				...event,
				metadata: {
					state: ProcessingState.PENDING_NOTIFICATION,
				},
			});
		}
	}

	private async processNotificationStage(stagedEvent: StagingAreaEventType) {
		const { eventId, event } = stagedEvent;
		const trackedEvent = this.processingEvents.get(eventId);
		if (!trackedEvent) {
			return;
		}

		try {
			this.logger.debug(`Notifying clients about event ${eventId}`);

			switch (true) {
				case stagedEvent.event.type === 'm.room.message':
					this.eventEmitterService.emit('homeserver.matrix.message', {
						event_id: stagedEvent.eventId,
						room_id: stagedEvent.roomId,
						sender: stagedEvent.event.sender,
						origin_server_ts: stagedEvent.event.origin_server_ts,
						content: {
							body: stagedEvent.event.content?.body as string,
							msgtype: stagedEvent.event.content?.msgtype as string,
							'm.relates_to': stagedEvent.event.content?.['m.relates_to'] as {
								rel_type: 'm.replace' | 'm.annotation' | 'm.thread';
								event_id: string;
							},
							'm.new_content': stagedEvent.event.content?.['m.new_content'] as {
								body: string;
								msgtype: string;
							},
							formatted_body: (stagedEvent.event.content?.formatted_body ||
								'') as string,
						},
					});
					break;
				case stagedEvent.event.type === 'm.reaction': {
					this.eventEmitterService.emit('homeserver.matrix.reaction', {
						event_id: stagedEvent.eventId,
						room_id: stagedEvent.roomId,
						sender: stagedEvent.event.sender,
						origin_server_ts: stagedEvent.event.origin_server_ts,
						content: stagedEvent.event.content as {
							'm.relates_to': {
								rel_type: 'm.annotation';
								event_id: string;
								key: string;
							};
						},
					});
					break;
				}
				case isRedactedEvent(event): {
					this.eventEmitterService.emit('homeserver.matrix.redaction', {
						event_id: stagedEvent.eventId,
						room_id: stagedEvent.roomId,
						sender: stagedEvent.event.sender,
						origin_server_ts: stagedEvent.event.origin_server_ts,
						redacts: event.content.redacts,
						content: {
							reason: event.content.reason,
						},
					});
					break;
				}
				case stagedEvent.event.type === 'm.room.member': {
					this.eventEmitterService.emit('homeserver.matrix.membership', {
						event_id: stagedEvent.eventId,
						room_id: stagedEvent.roomId,
						sender: stagedEvent.event.sender,
						state_key: stagedEvent.event.state_key as string,
						origin_server_ts: stagedEvent.event.origin_server_ts,
						content: stagedEvent.event.content as {
							membership: Membership;
							displayname?: string;
							avatar_url?: string;
							reason?: string;
						},
					});
					break;
				}
				case stagedEvent.event.type === 'm.room.name': {
					this.eventEmitterService.emit('homeserver.matrix.room.name', {
						room_id: stagedEvent.roomId,
						user_id: stagedEvent.event.sender,
						name: stagedEvent.event.content?.name as string,
					});
					break;
				}
				case stagedEvent.event.type === 'm.room.topic': {
					this.eventEmitterService.emit('homeserver.matrix.room.topic', {
						room_id: stagedEvent.roomId,
						user_id: stagedEvent.event.sender,
						topic: stagedEvent.event.content?.topic as string,
					});
					break;
				}
				case stagedEvent.event.type === 'm.room.power_levels': {
					const getRole = (powerLevel: number) => {
						if (powerLevel === 100) {
							return 'owner';
						}
						if (powerLevel === 50) {
							return 'moderator';
						}

						return 'user';
					};

					// at this point we potentially have the new power level event
					const oldRoomState =
						await this.stateService.getFullRoomStateBeforeEvent2(
							stagedEvent.eventId,
						);

					const oldPowerLevels = oldRoomState.powerLevels?.users;

					const changedUserPowers = (
						stagedEvent.event.content as PduPowerLevelsEventContent
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
								sender_id: stagedEvent.event.sender,
								user_id: userId,
								room_id: stagedEvent.roomId,
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
									sender_id: stagedEvent.event.sender,
									user_id: userId,
									room_id: stagedEvent.roomId,
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
								sender_id: stagedEvent.event.sender,
								user_id: userId,
								room_id: stagedEvent.roomId,
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
								sender_id: stagedEvent.event.sender,
								user_id: userId,
								room_id: stagedEvent.roomId,
								role: getRole(power),
							});
						}
					}

					break;
				}
				default:
					this.logger.warn(
						`Unknown event type: ${stagedEvent.event.type} for emitterService for now`,
					);
					break;
			}

			trackedEvent.state = ProcessingState.COMPLETED;
		} catch (error: unknown) {
			this.logger.warn(
				`Notification error for ${stagedEvent.eventId}: ${String(error)}`,
			);
			trackedEvent.state = ProcessingState.COMPLETED;
		}

		this.processingEvents.set(stagedEvent.eventId, trackedEvent);
	}
}
