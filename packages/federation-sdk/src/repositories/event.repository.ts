import type { Collection, Filter, FindCursor, FindOptions } from 'mongodb';
import type {
	EventBase,
	EventStore,
} from '@hs/homeserver/src/models/event.model';

export interface IEventRepository {
	getCollection(): Promise<Collection<EventStore>>;
	findById(eventId: string): Promise<EventStore | null>;
	findByIds(eventIds: string[]): Promise<EventStore[]>;
	findByRoomId(
		roomId: string,
		limit?: number,
		skip?: number,
	): Promise<EventStore[]>;
	findByRoomIdAndEventIds(
		roomId: string,
		eventIds: string[],
	): Promise<EventStore[]>;
	findLatestInRoom(roomId: string): Promise<EventStore | null>;
	find(query: Filter<EventStore>, options: FindOptions): Promise<EventStore[]>;
	create(
		event: EventBase,
		eventId?: string,
		args?: object,
		stateId?: string,
	): Promise<string>;
	createIfNotExists(event: EventBase): Promise<string>;
	findAuthEventsIdsByRoomId(roomId: string): Promise<EventStore[]>;
	createStaged(event: EventBase): Promise<string>;
	redactEvent(eventId: string, redactedEvent: EventBase): Promise<void>;
	upsert(event: EventBase): Promise<string>;
	removeFromStaging(roomId: string, eventId: string): Promise<void>;
	findOldestStaged(roomId: string): Promise<EventStore | null>;
	findPowerLevelsEventByRoomId(roomId: string): Promise<EventStore | null>;
	findAllJoinedMembersEventsByRoomId(roomId: string): Promise<EventStore[]>;
	findLatestEventByRoomIdBeforeTimestamp(
		roomId: string,
		timestamp: number,
	): Promise<EventStore | null>;
	findEventsByRoomIdAfterTimestamp(
		roomId: string,
		timestamp: number,
	): Promise<FindCursor<EventStore>>;
	updateStateId(eventId: string, stateId: string): Promise<void>;
}
