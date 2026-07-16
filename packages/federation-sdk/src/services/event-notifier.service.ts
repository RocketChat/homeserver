import { createLogger } from '@rocket.chat/federation-core';
import type { EventID, Pdu } from '@rocket.chat/federation-room';
import { RoomState } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { EventEmitterService } from './event-emitter.service';
import { StateService } from './state.service';

@singleton()
export class EventNotifierService {
	private readonly logger = createLogger('EventNotifierService');

	constructor(private readonly eventEmitterService: EventEmitterService, private readonly stateService: StateService) {}

	async notify(event: { eventId: EventID; event: Pdu }) {
		const {
			eventId,
			event: { room_id: roomId },
		} = event;

		this.logger.debug(`Notifying clients about event ${eventId}`);

		switch (true) {
			case event.event.type === 'm.room.create':
				await this.eventEmitterService.emit('homeserver.matrix.room.create', {
					event_id: eventId,
					event: event.event,
				});
				break;
			case event.event.type === 'm.room.message':
				await this.eventEmitterService.emit('homeserver.matrix.message', {
					event_id: eventId,
					event: event.event,
				});
				break;
			case event.event.type === 'm.room.encryption':
				await this.eventEmitterService.emit('homeserver.matrix.encryption', {
					event_id: eventId,
					event: event.event,
				});
				break;
			case event.event.type === 'm.room.encrypted':
				await this.eventEmitterService.emit('homeserver.matrix.encrypted', {
					event_id: eventId,
					event: event.event,
				});
				break;
			case event.event.type === 'm.reaction': {
				await this.eventEmitterService.emit('homeserver.matrix.reaction', {
					event_id: eventId,
					event: event.event,
				});
				break;
			}
			case event.event.type === 'm.room.redaction': {
				await this.eventEmitterService.emit('homeserver.matrix.redaction', {
					event_id: eventId,
					event: event.event,
				});
				break;
			}
			case event.event.type === 'm.room.member': {
				await this.eventEmitterService.emit('homeserver.matrix.membership', {
					event_id: eventId,
					event: event.event,
				});
				break;
			}
			case event.event.type === 'm.room.name': {
				await this.eventEmitterService.emit('homeserver.matrix.room.name', {
					event_id: eventId,
					event: event.event,
				});
				break;
			}
			case event.event.type === 'm.room.topic': {
				await this.eventEmitterService.emit('homeserver.matrix.room.topic', {
					event_id: eventId,
					event: event.event,
				});
				break;
			}
			case event.event.type === 'm.room.server_acl': {
				await this.eventEmitterService.emit('homeserver.matrix.room.server_acl', {
					event_id: eventId,
					event: event.event,
				});
				break;
			}
			case event.event.type === 'm.room.power_levels': {
				await this.eventEmitterService.emit('homeserver.matrix.room.power_levels', {
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
				const oldRoomState = new RoomState(await this.stateService.getStateBeforeEvent(plEvent));

				const oldPowerLevels = oldRoomState.powerLevels?.users;

				const changedUserPowers = event.event.content.users;

				if (!changedUserPowers) {
					this.logger.debug('No changed user powers, resetting all powers');
					// everyone set to "user" except for the owner
					const owner = oldRoomState.creator;
					if (!oldPowerLevels) {
						this.logger.debug('No current power levels, skipping');
						break;
					}

					for await (const userId of Object.keys(oldPowerLevels)) {
						if (userId === owner) {
							continue;
						}

						this.logger.debug(`Resetting power level for ${userId} to user`);

						await this.eventEmitterService.emit('homeserver.matrix.room.role', {
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
						for await (const [userId, power] of Object.entries(changedUserPowers)) {
							this.logger.debug(`Setting power level for ${userId} to ${power}`);
							await this.eventEmitterService.emit('homeserver.matrix.room.role', {
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

					const setOrUnsetPowerLevels = new Set(usersInNewPowerLevelEvent).difference(new Set(usersInOldPowerLevelEvent));

					this.logger.debug(
						{
							difference: Array.from(setOrUnsetPowerLevels),
						},
						'Strong difference in power levels',
					);

					// for the difference only new power level content matters
					for await (const userId of setOrUnsetPowerLevels) {
						const newPowerLevel = changedUserPowers[userId]; // if unset, it's 0, if set, it's the power level
						this.logger.debug(`Emitting event for ${userId} with new power level ${newPowerLevel ?? 0}`);
						await this.eventEmitterService.emit('homeserver.matrix.room.role', {
							sender_id: event.event.sender,
							user_id: userId,
							room_id: roomId,
							role: getRole(newPowerLevel),
						});
					}

					this.logger.debug('Emitting events for changed user powers');

					// now use the new content
					for await (const [userId, power] of Object.entries(changedUserPowers)) {
						if (
							power === oldPowerLevels[userId] || // no change
							setOrUnsetPowerLevels.has(userId) // already handled
						) {
							continue;
						}

						this.logger.debug(`Emitting event for ${userId} with power level ${power}`);

						await this.eventEmitterService.emit('homeserver.matrix.room.role', {
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
				this.logger.warn(`Unknown event type: ${event.event.type} for emitterService for now`);
				break;
		}
	}
}
