import { type RoomMemberEvent, isRoomMemberEvent } from '@hs/core';
import {
	type PduMembershipEventContent,
	PersistentEventFactory,
	getAuthChain,
} from '@hs/room';
import { singleton } from 'tsyringe';
import { ConfigService } from './config.service';
import { EventEmitterService } from './event-emitter.service';
import { EventService } from './event.service';
import { StateService } from './state.service';

@singleton()
export class SendJoinService {
	constructor(
		private readonly eventService: EventService,

		private readonly emitterService: EventEmitterService,
		private readonly stateService: StateService,
		private readonly configService: ConfigService,
	) {}

	async sendJoin(roomId: string, eventId: string, event: RoomMemberEvent) {
		const stateService = this.stateService;

		const roomVersion = await stateService.getRoomVersion(roomId);

		if (!roomVersion) {
			throw new Error('Room version not found');
		}

		// delete existing auth events and refill them
		event.auth_events = [];

		const joinEvent = PersistentEventFactory.createFromRawEvent(
			event,
			roomVersion,
		);

		await stateService.addAuthEvents(joinEvent);

		// now check the calculated id if it matches what is passed in param
		if (joinEvent.eventId !== eventId) {
			// this is important sanity check
			// while prev_events don't matter as much as it CAN change if we try to recalculate, auth events can not
			throw new Error('join event id did not match what was passed in param');
		}

		// fetch state before allowing join here - TODO: don't just persist the membership like this
		const state = await stateService.getFullRoomState(roomId);

		await stateService.persistStateEvent(joinEvent);

		if (joinEvent.rejected) {
			throw new Error(joinEvent.rejectedReason);
		}

		const configService = this.configService;

		const origin = configService.serverName;

		const authChain = [];

		for (const event of state.values()) {
			const authEvents = await getAuthChain(
				event,
				stateService._getStore(roomVersion),
			);
			authChain.push(...authEvents);
		}

		const authChainEvents = await this.eventService.getEventsByIds(authChain);

		const signedJoinEvent = await stateService.signEvent(joinEvent);

		this.emitterService.emit('homeserver.matrix.accept-invite', {
			event_id: eventId,
			room_id: roomId,
			sender: signedJoinEvent.sender,
			origin_server_ts: signedJoinEvent.originServerTs,
			content: {
				avatar_url:
					signedJoinEvent.getContent<PduMembershipEventContent>().avatar_url ||
					null,
				displayname:
					signedJoinEvent.getContent<PduMembershipEventContent>().displayname ||
					'',
				membership:
					signedJoinEvent.getContent<PduMembershipEventContent>().membership,
			},
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
