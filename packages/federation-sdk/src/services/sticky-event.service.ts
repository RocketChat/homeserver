import { createLogger } from '@rocket.chat/federation-core';
import {
	type AnyPdu,
	type EventID,
	type PersistentEventBase,
	type RoomID,
	type State,
	extractDomainFromId,
} from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { FederationSenderService } from './federation-sender.service';
import { StateService } from './state.service';
import { EventRepository } from '../repositories/event.repository';
import { getStickyExpiresAt } from '../utils/sticky';

// how long a newly joined server is given to store the room before it is sent events for it
export const NEW_SERVER_CATCH_UP_DELAY_MS = 10_000;

export type ActiveStickyEvent = {
	event_id: EventID;
	event: AnyPdu;
	expiresAt: number;
};

// sticky events (MSC4354): events that stay relevant to every member of a room for a while after
// they are sent, whatever the history visibility, such as MatrixRTC call memberships
@singleton()
export class StickyEventService {
	private readonly logger = createLogger('StickyEventService');

	constructor(
		@inject(delay(() => EventRepository))
		private readonly eventRepository: EventRepository,
		private readonly configService: ConfigService,
		private readonly stateService: StateService,
		private readonly federationSenderService: FederationSenderService,
	) {}

	/**
	 * Record how long a persisted, accepted event stays sticky, counting from when this
	 * server received it. Resolves to when its stickiness ends, or undefined when it is
	 * not sticky.
	 */
	async markSticky(event: PersistentEventBase, receivedAt: number): Promise<number | undefined> {
		if (event.rejected) {
			return undefined;
		}

		const expiresAt = getStickyExpiresAt(event.event, receivedAt);
		if (expiresAt === undefined) {
			return undefined;
		}

		await this.eventRepository.setSticky(event.eventId, { receivedAt, expiresAt });

		return expiresAt;
	}

	/**
	 * The sticky events of a room that have not expired yet, from any sender, oldest first.
	 */
	async getActiveStickyEvents(
		roomId: RoomID,
		{ type, now = Date.now() }: { type?: string; now?: number } = {},
	): Promise<ActiveStickyEvent[]> {
		const stored = await this.eventRepository.findActiveStickyByRoomId(roomId, now, type).toArray();

		return stored.flatMap(({ _id, event, sticky }) => (sticky ? [{ event_id: _id, event, expiresAt: sticky.expiresAt }] : []));
	}

	/**
	 * MSC4354 asks a server to push its own unexpired sticky events to every server
	 * that newly joins a room. Call it with every accepted event: when the event is
	 * the join of the first member of another server, that server is caught up after
	 * NEW_SERVER_CATCH_UP_DELAY_MS. `stateBefore` is the room state the event applies
	 * to, looked up when not given. Resolves to the server being caught up, if any;
	 * failures are logged, never thrown.
	 */
	async catchUpIfNewServer(event: PersistentEventBase, stateBefore?: State): Promise<string | undefined> {
		if (!event.isMembershipEvent() || event.getMembership() !== 'join' || !event.stateKey) {
			return undefined;
		}

		try {
			const server = extractDomainFromId(event.stateKey);
			if (server === this.configService.serverName) {
				return undefined;
			}

			const serversBefore = await this.stateService.getServerSetInRoom(
				event.roomId,
				stateBefore ?? (await this.stateService.getStateBeforeEvent(event)),
			);
			if (serversBefore.has(server)) {
				return undefined;
			}

			setTimeout(() => {
				void this.pushOwnStickyEvents(event.roomId, server);
			}, NEW_SERVER_CATCH_UP_DELAY_MS).unref?.();

			return server;
		} catch (err) {
			this.logger.error({ msg: 'Failed to check whether a join brings a new server', eventId: event.eventId, err });
			return undefined;
		}
	}

	/**
	 * Queue this server's own unexpired sticky events of a room to another server,
	 * oldest first. Resolves to how many were queued; failures are logged, never thrown.
	 */
	async pushOwnStickyEvents(roomId: RoomID, destination: string): Promise<number> {
		try {
			const active = await this.eventRepository.findActiveStickyByRoomId(roomId, Date.now()).toArray();
			const own = active.filter(({ event }) => extractDomainFromId(event.sender) === this.configService.serverName);

			for (const { event } of own) {
				this.federationSenderService.sendPDU(destination, event);
			}

			this.logger.info({ msg: 'Caught up a newly joined server on sticky events', roomId, destination, count: own.length });

			return own.length;
		} catch (err) {
			this.logger.error({ msg: 'Failed to push sticky events to a newly joined server', roomId, destination, err });
			return 0;
		}
	}
}
