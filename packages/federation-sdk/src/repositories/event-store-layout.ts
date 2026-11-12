import type { EventStore } from '@rocket.chat/federation-core';
import type { RoomID } from '@rocket.chat/federation-room';
import type { Filter, IndexDescription } from 'mongodb';
import { singleton } from 'tsyringe';

// how the events of a room are keyed in the events collection. rooms up to v11 are found by the
// room_id inside the event; from v12 the create event has no room_id, so those rooms are keyed
// by a roomId stored next to the event instead
export interface EventStoreLayout {
	roomFilter(roomId: string): Filter<EventStore>;

	// fields stored alongside a new event of the room
	roomFields(roomId: RoomID): Pick<EventStore, 'roomId'>;

	readonly indexes: IndexDescription[];
}

@singleton()
export class EventRoomIdLayout implements EventStoreLayout {
	readonly indexes: IndexDescription[] = [
		{ key: { 'event.room_id': 1, 'nextEventId': 1, 'event.depth': 1, 'createdAt': 1 } },
		{ key: { 'event.room_id': 1, 'event.type': 1 } },
	];

	roomFilter(roomId: string): Filter<EventStore> {
		return { 'event.room_id': roomId as RoomID };
	}

	roomFields(): Pick<EventStore, 'roomId'> {
		return {};
	}
}

@singleton()
export class TopLevelRoomIdLayout implements EventStoreLayout {
	readonly indexes: IndexDescription[] = [
		{
			key: { 'roomId': 1, 'nextEventId': 1, 'event.depth': 1, 'createdAt': 1 },
			partialFilterExpression: { roomId: { $exists: true } },
		},
		{
			key: { 'roomId': 1, 'event.type': 1 },
			partialFilterExpression: { roomId: { $exists: true } },
		},
	];

	roomFilter(roomId: string): Filter<EventStore> {
		return { roomId: roomId as RoomID };
	}

	roomFields(roomId: RoomID): Pick<EventStore, 'roomId'> {
		return { roomId };
	}
}
