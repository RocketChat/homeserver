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
import { findAllowedRedactionTarget } from '../utils/event-relations';
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

	// when off, events are handled as if MSC4354 did not exist: none is recorded, pushed or listed as sticky
	get enabled(): boolean {
		return this.configService.stickyEventsEnabled;
	}

	/**
	 * Record how long a persisted, accepted event stays sticky, counting from when this
	 * server received it. Resolves to when its stickiness ends as stored, which is the
	 * first time recorded for an event seen more than once, or undefined when it is not
	 * sticky.
	 */
	async markSticky(event: PersistentEventBase, receivedAt: number): Promise<number | undefined> {
		if (!this.enabled || event.rejected) {
			return undefined;
		}

		const expiresAt = getStickyExpiresAt(event.event, receivedAt);
		if (expiresAt === undefined) {
			return undefined;
		}

		const stored = await this.eventRepository.setSticky(event.eventId, { receivedAt, expiresAt });

		return stored?.expiresAt;
	}

	/**
	 * A redacted event is no longer sticky. Call it with every accepted event: when the
	 * event is a redaction its sender is allowed to make, the stickiness of its target
	 * ends. Resolves to the redacted event, if any; failures are logged, never thrown.
	 */
	async endStickinessOfRedacted(event: PersistentEventBase): Promise<EventID | undefined> {
		if (!this.enabled || event.type !== 'm.room.redaction') {
			return undefined;
		}

		try {
			const redacts = await findAllowedRedactionTarget(event, this.stateService);
			if (redacts) {
				await this.eventRepository.clearSticky(redacts);
			}

			return redacts;
		} catch (err) {
			this.logger.error({ msg: 'Failed to end the stickiness of a redacted event', eventId: event.eventId, err });
			return undefined;
		}
	}

	async getActiveStickyEvents(
		roomId: RoomID,
		{ type, now = Date.now() }: { type?: string; now?: number } = {},
	): Promise<ActiveStickyEvent[]> {
		if (!this.enabled) {
			return [];
		}

		const stored = await this.eventRepository.findActiveStickyByRoomId(roomId, now, { type }).toArray();

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
		if (!this.enabled || !event.isMembershipEvent() || event.getMembership() !== 'join' || !event.stateKey) {
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
	 * oldest first, if that server is still in the room. Resolves to how many were
	 * queued; failures are logged, never thrown.
	 */
	async pushOwnStickyEvents(roomId: RoomID, destination: string): Promise<number> {
		if (!this.enabled) {
			return 0;
		}

		try {
			// the catch-up runs a while after the join, by when the server may have left again
			if (!(await this.stateService.getServerSetInRoom(roomId)).has(destination)) {
				this.logger.info({ msg: 'Skipped catching up a server that left the room', roomId, destination });
				return 0;
			}

			const own = await this.eventRepository
				.findActiveStickyByRoomId(roomId, Date.now(), { senderServer: this.configService.serverName })
				.toArray();

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

	/**
	 * Queue again this server's own unexpired sticky events, oldest first, to the servers
	 * joined to their rooms: to `destination` alone, or to all of them when not given.
	 * It makes up for pushes that were lost, as when this server restarts or gives up on
	 * a server that is unreachable; a server that already has an event ignores it.
	 * Resolves to how many were queued; failures are logged, never thrown.
	 */
	async pushOwnStickyEventsToServers(destination?: string): Promise<number> {
		if (!this.enabled) {
			return 0;
		}

		try {
			const { serverName } = this.configService;
			const own = await this.eventRepository.findActiveStickyBySenderServer(serverName, Date.now()).toArray();

			const roomIds = [...new Set(own.map(({ event }) => event.room_id))];
			const serversByRoom = new Map<RoomID, Set<string>>();
			// a room whose servers cannot be looked up must not keep the others from being pushed
			await Promise.all(
				roomIds.map(async (roomId) => {
					try {
						serversByRoom.set(roomId, await this.stateService.getServerSetInRoom(roomId));
					} catch (err) {
						this.logger.error({ msg: 'Failed to look up the servers of a room to push sticky events again', roomId, err });
					}
				}),
			);

			let count = 0;

			for (const { event } of own) {
				for (const server of serversByRoom.get(event.room_id) ?? []) {
					if (server === serverName || (destination && server !== destination)) {
						continue;
					}
					this.federationSenderService.sendPDU(server, event);
					count++;
				}
			}

			if (count > 0) {
				this.logger.info({ msg: 'Pushed own sticky events again', destination, count });
			}

			return count;
		} catch (err) {
			this.logger.error({ msg: 'Failed to push own sticky events again', destination, err });
			return 0;
		}
	}
}
