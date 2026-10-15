import { EventRouterService } from '@rocket.chat/appservice';
import { createLogger } from '@rocket.chat/federation-core';
import {
	type EventID,
	type PduForType,
	type PduType,
	type PduWithHashesAndSignaturesOptional,
	type PersistentEventBase,
	type RejectCode,
	RoomID,
	type RoomVersion,
	UserID,
} from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { FederationService } from './federation.service';
import { StateService } from './state.service';
import { StickyEventService } from './sticky-event.service';
import { getEventSchemaForType } from '../utils/event-schemas';
import { MAX_STICKY_DURATION_MS, STICKY_EVENT_FIELD } from '../utils/sticky';

// the room's authorization rules refused an event built on behalf of a local user
export class EventRejectedError extends Error {
	readonly eventId: EventID;

	readonly code: RejectCode;

	readonly reason: string;

	constructor(event: PersistentEventBase, options?: ErrorOptions) {
		super(`Event ${event.eventId} was rejected: ${event.rejectReason}`, options);
		this.name = 'EventRejectedError';
		this.eventId = event.eventId;
		this.code = event.rejectCode as RejectCode;
		this.reason = event.rejectReason;
	}
}

@singleton()
export class EventSenderService {
	private readonly logger = createLogger('EventSenderService');

	constructor(
		private readonly stateService: StateService,
		private readonly federationService: FederationService,
		private readonly eventRouterService: EventRouterService,
		private readonly stickyEventService: StickyEventService,
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

		this.dispatch(event);

		return event;
	}

	/**
	 * Set a piece of room state on behalf of a local user, of any event type and
	 * under any state key. The event is persisted, relayed to every federated
	 * server in the room and routed to interested bridges.
	 *
	 * Empty content is valid: it is how some state is withdrawn, e.g. a MatrixRTC
	 * call membership when its member leaves the call.
	 *
	 * @throws {EventRejectedError} when the room's authorization rules refuse the
	 * event, e.g. because the sender lacks the power level its type requires
	 */
	async sendStateEvent(
		roomId: RoomID,
		eventType: string,
		stateKey: string,
		content: Record<string, unknown>,
		senderUserId: UserID,
	): Promise<{ eventId: EventID }> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);

		const event = await this.buildAndPersist(
			{
				type: eventType,
				state_key: stateKey,
				content,
				room_id: roomId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderUserId,
			},
			roomVersion,
		);

		this.dispatch(event);

		return { eventId: event.eventId };
	}

	/**
	 * Send a sticky event (MSC4354) on behalf of a local user: a message event
	 * that stays relevant to every member of the room for `durationMs` after it
	 * is sent, whatever the history visibility, such as a MatrixRTC call
	 * membership, ring or decline. The event is persisted, relayed to every
	 * federated server in the room and routed to interested bridges.
	 *
	 * @throws {RangeError} when `durationMs` is not a whole number of
	 * milliseconds between 1 and one hour
	 * @throws {EventRejectedError} when the room's authorization rules refuse the event
	 */
	async sendStickyEvent(
		roomId: RoomID,
		eventType: string,
		content: Record<string, unknown>,
		senderUserId: UserID,
		durationMs: number,
	): Promise<{ eventId: EventID }> {
		if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_STICKY_DURATION_MS) {
			throw new RangeError(`A sticky event lasts from 1 to ${MAX_STICKY_DURATION_MS} ms, not ${durationMs}`);
		}

		const roomVersion = await this.stateService.getRoomVersion(roomId);
		const sentAt = Date.now();

		const event = await this.buildAndPersist(
			{
				type: eventType,
				content,
				room_id: roomId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: sentAt,
				sender: senderUserId,
				[STICKY_EVENT_FIELD]: { duration_ms: durationMs },
			},
			roomVersion,
		);

		await this.stickyEventService.markSticky(event, sentAt);

		this.dispatch(event);

		return { eventId: event.eventId };
	}

	// an event of a local user, validated, signed, authorized and persisted
	private async buildAndPersist(
		rawEvent: { type: string } & Record<string, unknown>,
		roomVersion: RoomVersion,
	): Promise<PersistentEventBase> {
		const validation = getEventSchemaForType(rawEvent.type, roomVersion).safeParse(rawEvent);
		if (!validation.success) {
			throw new Error(`Event of type ${rawEvent.type} failed schema validation: ${JSON.stringify(validation.error.format())}`);
		}

		const event = await this.stateService.buildEvent(
			rawEvent as unknown as PduWithHashesAndSignaturesOptional<PduForType<PduType>>,
			roomVersion,
		);

		try {
			await this.stateService.handlePdu(event);
		} catch (error) {
			if (event.rejected) {
				throw new EventRejectedError(event, { cause: error });
			}
			throw error;
		}
		if (event.rejected) {
			throw new EventRejectedError(event);
		}

		return event;
	}

	/**
	 * Fan a persisted event out to every federated server in the room and to
	 * interested appservices. Fire-and-forget: each channel's failure is logged,
	 * never thrown, so a problem on one channel blocks neither the caller nor the
	 * other channel.
	 */
	dispatch(event: PersistentEventBase): void {
		void this.federationService
			.sendEventToAllServersInRoom(event)
			.catch((err) => this.logger.error({ msg: 'Failed to send event to servers in room', err }));
		void this.eventRouterService
			.routePersistent(event)
			.catch((err) => this.logger.error({ msg: 'Failed to route event to appservices', err }));
	}
}
