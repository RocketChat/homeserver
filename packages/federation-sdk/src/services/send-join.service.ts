import { getAuthChain } from '@rocket.chat/federation-room';
import type { PduForType, RoomID, type EventID } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import type { ConfigService } from './config.service';
import type { EventEmitterService } from './event-emitter.service';
import type { EventService } from './event.service';
import type { FederationService } from './federation.service';
import type { StateService } from './state.service';

@singleton()
export class SendJoinService {
	constructor(
		private readonly eventService: EventService,
		private readonly emitterService: EventEmitterService,
		private readonly stateService: StateService,
		private readonly configService: ConfigService,
		private readonly federationService: FederationService,
	) {}

	async sendJoin(roomId: RoomID, eventId: EventID, event: PduForType<'m.room.member'>) {
		const { stateService } = this;

		const roomVersion = await stateService.getRoomVersion(roomId);

		if (!roomVersion) {
			throw new Error('Room version not found');
		}

		const joinEvent = await this.stateService.buildEvent<'m.room.member'>(event, roomVersion);

		// now check the calculated id if it matches what is passed in param
		if (joinEvent.eventId !== eventId) {
			// this is important sanity check
			// while prev_events don't matter as much as it CAN change if we try to recalculate, auth events can not
			throw new Error('join event id did not match what was passed in param');
		}

		// fetch state before allowing join here - TODO: don't just persist the membership like this
		const state = await stateService.getLatestRoomState(roomId);
		await stateService.handlePdu(joinEvent);

		// accepted? allow other servers to start processing already
		void this.federationService.sendEventToAllServersInRoom(joinEvent);

		const { configService } = this;

		const origin = configService.serverName;

		const authChain = [];

		for (const event of state.values()) {
			const authEvents = await getAuthChain(event, stateService._getStore(roomVersion));
			authChain.push(...authEvents);
		}

		const authChainEvents = await this.eventService.getEventsByIds(authChain);

		const signedJoinEvent = await stateService.signEvent(joinEvent);

		await this.emitterService.emit('homeserver.matrix.membership', {
			event_id: eventId,
			event: signedJoinEvent.event,
		});

		return {
			origin,
			event: signedJoinEvent.event,
			members_omitted: false, // less requests
			state: Array.from(state.values()).map((event) => {
				return event.event;
			}), // values().map should have worked but editor is complaining
			auth_chain: authChainEvents.map((event) => {
				return event.event;
			}),
		};
	}
}
