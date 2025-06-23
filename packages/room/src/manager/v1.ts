import { type EventStore, PersistentEventBase } from './event-wrapper';
import type { RoomVersion1And2 } from './type';

export class PersistentEventV1 extends PersistentEventBase<RoomVersion1And2> {
	async getAuthorizationEvents(
		store: EventStore,
	): Promise<PersistentEventBase[]> {
		const authEventIds: string[] = [];
		const authEventHashes: string[] = [];

		for (const id of this.rawEvent.auth_events) {
			if (typeof id === 'string') {
				authEventIds.push(id);
			} else {
				authEventHashes.push(id.sha256);
			}
		}

		return Promise.all([
			await store.getEvents(authEventIds),
			await store.getEventsByHashes(authEventHashes),
		]).then(([eventsById, eventsByHash]) => eventsById.concat(eventsByHash));
	}

	async getPreviousEvents(store: EventStore): Promise<PersistentEventBase[]> {
		const prevEventIds: string[] = [];
		const prevEventHashes: string[] = [];

		for (const id of this.rawEvent.prev_events) {
			if (typeof id === 'string') {
				prevEventIds.push(id);
			} else {
				prevEventHashes.push(id.sha256);
			}
		}

		return Promise.all([
			await store.getEvents(prevEventIds),
			await store.getEventsByHashes(prevEventHashes),
		]).then(([eventsById, eventsByHash]) => eventsById.concat(eventsByHash));
	}

	// SPEC: https://spec.matrix.org/v1.12/rooms/v1/#event-ids
	// $opaque_id:domain
	// where domain is the server name of the homeserver which created the room, and opaque_id is a locally-unique string.
	get eventId(): string {
		return this.rawEvent.event_id!; //TODO: fix this
	}

	// v1 has all as strings
	transformPowerLevelEventData(data: string): number {
		// TODO: fix test acrtual;ly
		if (typeof data === 'number') {
			return data;
		}
		return Number.parseInt(data.trim(), 10);
	}
}
