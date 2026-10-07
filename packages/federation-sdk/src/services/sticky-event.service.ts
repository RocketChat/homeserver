import type { AnyPdu, EventID, PersistentEventBase, RoomID } from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';

import { EventRepository } from '../repositories/event.repository';
import { getStickyExpiresAt } from '../utils/sticky';

export type ActiveStickyEvent = {
	event_id: EventID;
	event: AnyPdu;
	expiresAt: number;
};

// sticky events (MSC4354): events that stay relevant to every member of a room for a while after
// they are sent, whatever the history visibility, such as MatrixRTC call memberships
@singleton()
export class StickyEventService {
	constructor(
		@inject(delay(() => EventRepository))
		private readonly eventRepository: EventRepository,
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
}
