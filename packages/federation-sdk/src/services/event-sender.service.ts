import { EventRouterService } from '@rocket.chat/appservice';
import { createLogger } from '@rocket.chat/federation-core';
import {
	type PduForType,
	type PduType,
	type PduWithHashesAndSignaturesOptional,
	type PersistentEventBase,
	RoomID,
	UserID,
} from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { FederationService } from './federation.service';
import { StateService } from './state.service';
import { getEventSchemaForType } from '../utils/event-schemas';

@singleton()
export class EventSenderService {
	private readonly logger = createLogger('EventSenderService');

	constructor(
		private readonly stateService: StateService,
		private readonly federationService: FederationService,
		private readonly eventRouterService: EventRouterService,
	) {}

	/**
	 * Send an arbitrary event into a room. Use this for events that are not
	 * plain text messages — e.g. the ping events bridges emit. The event is
	 * persisted, relayed to every federated server in the room and routed to
	 * interested bridges, exactly like any other event.
	 *
	 * Custom (vendor-namespaced) event types the homeserver does not know about
	 * are allowed through, as the Matrix spec permits. Known event types are
	 * validated against their schema, just like any other event.
	 */
	async sendCustomEvent(
		roomId: RoomID,
		eventType: string,
		content: Record<string, unknown>,
		senderUserId: UserID,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(`Room version not found for room ${roomId} while trying to send custom event`);
		}

		const rawEvent = {
			type: eventType,
			content,
			room_id: roomId,
			auth_events: [],
			depth: 0,
			prev_events: [],
			origin_server_ts: Date.now(),
			sender: senderUserId,
		};

		const validation = getEventSchemaForType(eventType, roomVersion).safeParse(rawEvent);
		if (!validation.success) {
			throw new Error(`Custom event of type ${eventType} failed schema validation: ${JSON.stringify(validation.error.format())}`);
		}

		const event = await this.stateService.buildEvent(
			rawEvent as unknown as PduWithHashesAndSignaturesOptional<PduForType<PduType>>,
			roomVersion,
		);

		await this.stateService.handlePdu(event);
		if (event.rejected) {
			throw new Error(event.rejectReason);
		}

		void this.federationService
			.sendEventToAllServersInRoom(event)
			.catch((err) => this.logger.error({ msg: 'Failed to send event to servers in room', err }));
		void this.eventRouterService
			.routePersistent(event)
			.catch((err) => this.logger.error({ msg: 'Failed to route event to appservices', err }));

		return event;
	}
}
