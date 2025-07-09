import {
	PduType,
	PduTypeRoomAliases,
	PduTypeRoomCreate,
	PduTypeRoomHistoryVisibility,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomPowerLevels,
	Pdu,
} from '../types/v3-11';
import {
	type EventStore,
	PersistentEventBase,
	REDACT_ALLOW_ALL_KEYS,
} from './event-wrapper';
import type { RoomVersion1And2 } from './type';

export class PersistentEventV1 extends PersistentEventBase<RoomVersion1And2> {
	async getAuthorizationEvents(
		store: EventStore,
	): Promise<PersistentEventBase<RoomVersion1And2>[]> {
		const authEventIds: string[] = [];
		const authEventHashes: string[] = [];

		const event = this.rawEvent as Pdu;

		for (const id of event.auth_events) {
			if (typeof id === 'string') {
				authEventIds.push(id);
			} else {
				authEventHashes.push(id.sha256);
			}
		}

		// @ts-ignore fix EventStore typings
		return Promise.all([
			await store.getEvents(authEventIds),
			await store.getEventsByHashes(authEventHashes),
		]).then(([eventsById, eventsByHash]) => eventsById.concat(eventsByHash));
	}

	async getPreviousEvents(
		store: EventStore,
	): Promise<PersistentEventBase<RoomVersion1And2>[]> {
		const prevEventIds: string[] = [];
		const prevEventHashes: string[] = [];

		const event = this.rawEvent as Pdu;

		for (const id of event.prev_events) {
			if (typeof id === 'string') {
				prevEventIds.push(id);
			} else {
				prevEventHashes.push(id.sha256);
			}
		}

		// @ts-ignore fix EventStore typings
		return Promise.all([
			await store.getEvents(prevEventIds),
			await store.getEventsByHashes(prevEventHashes),
		]).then(([eventsById, eventsByHash]) => eventsById.concat(eventsByHash));
	}

	// SPEC: https://spec.matrix.org/v1.12/rooms/v1/#event-ids
	// $opaque_id:domain
	// where domain is the server name of the homeserver which created the room, and opaque_id is a locally-unique string.
	get eventId() {
		return this.rawEvent.event_id;
	}

	getAllowedKeys() {
		return [
			'event_id',
			'type',
			'room_id',
			'sender',
			'state_key',
			'hashes',
			'signatures',
			'depth',
			'prev_events',
			'auth_events',
			'origin_server_ts',
			'origin',
			'prev_state',
			'membership',
		];
	}

	getAllowedContentKeys(): Record<
		string,
		string[] | typeof REDACT_ALLOW_ALL_KEYS
	> {
		return {
			[PduTypeRoomCreate]: ['creator'],
			[PduTypeRoomMember]: ['membership'],
			[PduTypeRoomJoinRules]: ['join_rule'],
			[PduTypeRoomPowerLevels]: [
				'users',
				'users_default',
				'events',
				'events_default',
				'state_default',
				'ban',
				'kick',
				'redact',
			],
			[PduTypeRoomAliases]: ['aliases'],
			[PduTypeRoomHistoryVisibility]: ['history_visibility'],
		};
	}
}
