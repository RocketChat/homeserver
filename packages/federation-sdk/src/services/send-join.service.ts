import { type RoomMemberEvent, createLogger } from '@hs/core';
import { inject, singleton } from 'tsyringe';
import { ConfigService } from './config.service';
import { EventEmitterService } from './event-emitter.service';
import type { EventService } from './event.service';
import { StateService } from './state.service';
import {
	getAuthChain,
	type PduMembershipEventContent,
	PersistentEventFactory,
} from '@hs/room';

@singleton()
export class SendJoinService {
	private readonly logger = createLogger('SendJoinService');

	constructor(
		@inject('EventService') private readonly eventService: EventService,
		@inject(EventEmitterService)
		private readonly emitterService: EventEmitterService,
		@inject(StateService) private readonly stateService: StateService,
		@inject(ConfigService) private readonly configService: ConfigService,
	) {}

	// sendJoin handler send_join endpoint request, just handles OTHERS joining our rooms
	async sendJoin(roomId: string, eventId: string, event: RoomMemberEvent) {
		this.logger.debug('handling room join request', { roomId, eventId, event });

		const stateService = this.stateService;

		const roomVersion = await stateService.getRoomVersion(roomId);

		if (!roomVersion) {
			throw new Error('Room version not found');
		}

		this.logger.debug('joining room version', { roomVersion });

		const eventAny = event as any;

		// delete existing auth events and refill them
		eventAny.auth_events = [];

		const joinEvent = PersistentEventFactory.createFromRawEvent(
			eventAny,
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

		const origin = configService.getServerConfig().name;

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
