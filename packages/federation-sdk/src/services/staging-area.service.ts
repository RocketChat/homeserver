import type { EventBase, EventStore, Membership } from '@hs/core';
import { inject, singleton } from 'tsyringe';
import { StagingAreaQueue } from '../queues/staging-area.queue';

import { createLogger, isRedactedEvent } from '@hs/core';
import {
	Pdu,
	PduPowerLevelsEventContent,
	PersistentEventFactory,
} from '@hs/room';
import { EventAuthorizationService } from './event-authorization.service';
import { EventEmitterService } from './event-emitter.service';
import { EventStateService } from './event-state.service';
import { EventService } from './event.service';

import { LockRepository } from '../repositories/lock.repository';
import { ConfigService } from './config.service';
import { MissingEventService } from './missing-event.service';
import { StateService } from './state.service';

@singleton()
export class StagingAreaService {
	// private processingEvents = new Map<string, ExtendedStagingEvent>();
	private readonly logger = createLogger('StagingAreaService');

	constructor(
		private readonly configService: ConfigService,
		private readonly eventService: EventService,
		private readonly missingEventsService: MissingEventService,
		private readonly stagingAreaQueue: StagingAreaQueue,
		private readonly eventAuthService: EventAuthorizationService,
		private readonly eventStateService: EventStateService,
		private readonly eventEmitterService: EventEmitterService,
		private readonly stateService: StateService,
		private readonly lockRepository: LockRepository,
	) {}

	extractEventsFromIncomingPDU(pdu: EventBase) {
		const authEvents = pdu.auth_events || [];
		const prevEvents = pdu.prev_events || [];
		return [...authEvents, ...prevEvents];
	}

	async processEventForRoom(roomId: string) {
		// TODO add some debug logs

		let event = await this.eventService.getNextStagedEventForRoom(roomId);
		if (!event) {
			this.logger.debug({ msg: 'No staged event found for room', roomId });
			await this.lockRepository.releaseLock(
				roomId,
				this.configService.instanceId,
			);
			return;
		}

		while (event) {
			this.logger.debug({ msg: 'Processing event', eventId: event._id });
			try {
				await this.processDependencyStage(event);
				await this.processAuthorizationStage(event);
				await this.stateService.persistEvent(event.event);
				await this.processNotificationStage(event);

				await this.eventService.markEventAsUnstaged(event);

				// TODO add missing logic from synapse: Prune the event queue if it's getting large.
			} catch (err: unknown) {
				this.logger.error({
					msg: 'Error processing event',
					err,
				});
			}

			event = await this.eventService.getNextStagedEventForRoom(roomId);
		}

		// release the lock after processing
		await this.lockRepository.releaseLock(
			roomId,
			this.configService.instanceId,
		);
	}

	private async processDependencyStage(event: EventStore<EventBase>) {
		const eventId = event._id;

		const eventIds = this.extractEventsFromIncomingPDU(event.event);
		this.logger.debug(
			`Checking dependencies for event ${eventId}: ${eventIds.length} references`,
		);

		const { missing } = await this.eventService.checkIfEventsExists(
			eventIds.flat(),
		);

		if (missing.length === 0) {
			return;
		}
		this.logger.debug(`Missing ${missing.length} events for ${eventId}`);
		// trackedEvent.missingEvents = missing;

		for (const missingId of missing) {
			this.logger.debug(
				`Adding missing event ${missingId} to missing events service`,
			);

			await this.missingEventsService.fetchMissingEvent({
				eventId: missingId,
				roomId: event.event.room_id,
				origin: event.origin,
			});
		}

		// trackedEvent.retryCount = (trackedEvent.retryCount || 0) + 1;

		// if (trackedEvent.retryCount < 5) {
		// 	setTimeout(() => {
		// 		this.stagingAreaQueue.enqueue({
		// 			...event,
		// 			metadata: {
		// 				state: ProcessingState.PENDING_DEPENDENCIES,
		// 			},
		// 		});
		// 	}, 1000 * trackedEvent.retryCount); // Exponential backoff
		// } else {
		// 	trackedEvent.state = ProcessingState.REJECTED;
		// 	trackedEvent.error = `Failed to fetch dependencies after ${trackedEvent.retryCount} attempts`;
		// 	this.processingEvents.set(eventId, trackedEvent);
		// }
	}

	private async processAuthorizationStage(event: EventStore<Pdu>) {
		this.logger.debug(`Authorizing event ${event._id}`);
		const authEvents = await this.eventService.getAuthEventIds(
			'm.room.message',
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

	private async processNotificationStage(event: EventStore<Pdu>) {
		this.logger.debug(`Notifying clients about event ${event._id}`);

		const {
			_id: eventId,
			event: { room_id: roomId },
		} = event;

		switch (true) {
			case event.event.type === 'm.room.message':
				this.eventEmitterService.emit('homeserver.matrix.message', {
					event_id: eventId,
					room_id: roomId,
					sender: event.event.sender,
					origin_server_ts: event.event.origin_server_ts,
					content: {
						body: event.event.content?.body as string,
						msgtype: event.event.content?.msgtype as string,
						'm.relates_to': event.event.content?.['m.relates_to'] as {
							rel_type: 'm.replace' | 'm.annotation' | 'm.thread';
							event_id: string;
						},
						'm.new_content': event.event.content?.['m.new_content'] as {
							body: string;
							msgtype: string;
						},
						formatted_body: (event.event.content?.formatted_body ||
							'') as string,
					},
				});
				break;
			case event.event.type === 'm.reaction': {
				this.eventEmitterService.emit('homeserver.matrix.reaction', {
					event_id: eventId,
					room_id: roomId,
					sender: event.event.sender,
					origin_server_ts: event.event.origin_server_ts,
					content: event.event.content as {
						'm.relates_to': {
							rel_type: 'm.annotation';
							event_id: string;
							key: string;
						};
					},
				});
				break;
			}
			case isRedactedEvent(event.event): {
				this.eventEmitterService.emit('homeserver.matrix.redaction', {
					event_id: eventId,
					room_id: roomId,
					sender: event.event.sender,
					origin_server_ts: event.event.origin_server_ts,
					redacts: event.event.content.redacts,
					content: {
						reason: event.event.content?.reason as string | undefined,
					},
				});
				break;
			}
			case event.event.type === 'm.room.member': {
				this.eventEmitterService.emit('homeserver.matrix.membership', {
					event_id: eventId,
					room_id: roomId,
					sender: event.event.sender,
					state_key: event.event.state_key as string,
					origin_server_ts: event.event.origin_server_ts,
					content: event.event.content as {
						membership: Membership;
						displayname?: string;
						avatar_url?: string;
						reason?: string;
					},
				});
				break;
			}
			case event.event.type === 'm.room.name': {
				this.eventEmitterService.emit('homeserver.matrix.room.name', {
					room_id: roomId,
					user_id: event.event.sender,
					name: event.event.content?.name as string,
				});
				break;
			}
			case event.event.type === 'm.room.topic': {
				this.eventEmitterService.emit('homeserver.matrix.room.topic', {
					room_id: roomId,
					user_id: event.event.sender,
					topic: event.event.content?.topic as string,
				});
				break;
			}
			case event.event.type === 'm.room.power_levels': {
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
					await this.stateService.getFullRoomStateBeforeEvent2(eventId);

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
