import { singleton } from 'tsyringe';
import type { Collection, Filter, FindCursor, FindOptions } from 'mongodb';
import { generateId } from '@hs/core';
import type { EventBase, EventBaseWithOptionalId, EventStore } from '@hs/core';
import { DatabaseConnectionService } from '../services/database-connection.service';
import { MongoError } from 'mongodb';

@singleton()
export class EventRepository {
	private collection: Collection<EventStore> | null = null;

	constructor(private readonly dbConnection: DatabaseConnectionService) {
		this.getCollection();
	}

	async getCollection(): Promise<Collection<EventStore>> {
		const db = await this.dbConnection.getDb();
		this.collection = db.collection<EventStore>('events');
		return this.collection;
	}

	async findById(eventId: string): Promise<EventStore | null> {
		const collection = await this.getCollection();
		return collection.findOne({ eventId: eventId });
	}

	async findByIds(eventIds: string[]): Promise<EventStore[]> {
		if (!eventIds.length) return [];

		const collection = await this.getCollection();
		return collection.find({ eventId: { $in: eventIds } }).toArray();
	}

	async findByRoomId(
		roomId: string,
		limit = 50,
		skip = 0,
	): Promise<EventStore[]> {
		const collection = await this.getCollection();
		return collection
			.find({ 'event.room_id': roomId })
			.sort({ 'event.origin_server_ts': -1 })
			.skip(skip)
			.limit(limit)
			.toArray();
	}

	async findByRoomIdAndEventIds(
		roomId: string,
		eventIds: string[],
	): Promise<EventStore[]> {
		if (!eventIds.length) return [];

		const collection = await this.getCollection();
		return collection
			.find({ 'event.room_id': roomId, eventId: { $in: eventIds } })
			.toArray();
	}

	async findLatestInRoom(roomId: string): Promise<EventStore | null> {
		const collection = await this.getCollection();
		return collection.findOne(
			{ 'event.room_id': roomId },
			{ sort: { 'event.depth': -1 } },
		);
	}

	async find(
		query: Filter<EventStore>,
		options: FindOptions,
	): Promise<EventStore[]> {
		const collection = await this.getCollection();
		return collection.find(query, options).toArray();
	}

	async create(
		event: EventBase,
		eventId: string,
		stateId = '',
	): Promise<string | undefined> {
		return this.persistEvent(event, eventId, stateId);
	}

	async createIfNotExists(event: EventBaseWithOptionalId): Promise<string> {
		const collection = await this.getCollection();
		const id = event.event_id || generateId(event);

		const existingEvent = await collection.findOne({ eventId: id });
		if (existingEvent) return id;

		await collection.insertOne({
			// @ts-ignore idk why complaining
			eventId: id,
			event,
			stateId: '',
			createdAt: new Date(),
			_id: '',
			nextEventId: '',
		});

		return id;
	}

	async findAuthEventsIdsByRoomId(roomId: string): Promise<EventStore[]> {
		const collection = await this.getCollection();
		return collection
			.find({
				'event.room_id': roomId,
				$or: [
					{
						'event.type': {
							$in: [
								'm.room.create',
								'm.room.power_levels',
								'm.room.join_rules',
							],
						},
					},
					{
						'event.type': 'm.room.member',
						'event.content.membership': 'invite',
					},
				],
			})
			.toArray();
	}

	async createStaged(event: EventBaseWithOptionalId): Promise<string> {
		const collection = await this.getCollection();
		const id = event.event_id || generateId(event);

		await collection.insertOne({
			// @ts-ignore idk why complaining (2)
			eventId: id,
			event,
			stateId: '',
			staged: true,
			createdAt: new Date(),
			_id: '',
			nextEventId: '',
		});

		return id;
	}

	async redactEvent(eventId: string, redactedEvent: EventBase): Promise<void> {
		const collection = await this.getCollection();

		await collection.updateOne(
			{ eventId: eventId },
			{ $set: { event: redactedEvent } }, // Purposefully replacing the entire event
		);
	}

	async upsert(event: EventBaseWithOptionalId): Promise<string> {
		const collection = await this.getCollection();
		const id = event.event_id || generateId(event);

		await collection.updateOne(
			{ eventId: id },
			{ $set: { eventId: id, event } },
			{ upsert: true },
		);

		return id;
	}

	async removeFromStaging(roomId: string, eventId: string): Promise<void> {
		const collection = await this.getCollection();
		await collection.updateOne(
			{ eventId: eventId, 'event.room_id': roomId },
			{ $unset: { staged: 1 } },
		);
	}

	async findOldestStaged(roomId: string): Promise<EventStore | null> {
		const collection = await this.getCollection();
		return collection.findOne(
			{ staged: true, 'event.room_id': roomId },
			{ sort: { 'event.origin_server_ts': 1 } },
		);
	}

	public async findPowerLevelsEventByRoomId(
		roomId: string,
	): Promise<EventStore | null> {
		const collection = await this.getCollection();
		return collection.findOne({
			'event.room_id': roomId,
			'event.type': 'm.room.power_levels',
		});
	}

	public async findAllJoinedMembersEventsByRoomId(
		roomId: string,
	): Promise<EventStore[]> {
		const collection = await this.getCollection();
		return collection
			.find({
				'event.room_id': roomId,
				'event.type': 'm.room.member',
				'event.content.membership': 'join',
			})
			.toArray();
	}

	async findLatestEventByRoomIdBeforeTimestamp(
		roomId: string,
		timestamp: number,
	): Promise<EventStore | null> {
		const collection = await this.getCollection();
		return collection.findOne(
			{
				'event.room_id': roomId,
				'event.origin_server_ts': { $lt: timestamp },
			},
			{
				sort: {
					'event.origin_server_ts': -1,
				},
			},
		);
	}

	async findEventsByRoomIdAfterTimestamp(
		roomId: string,
		timestamp: number,
	): Promise<FindCursor<EventStore>> {
		const collection = await this.getCollection();
		return collection
			.find({
				'event.room_id': roomId,
				'event.origin_server_ts': { $gt: timestamp },
			})
			.sort({
				'event.origin_server_ts': 1,
			});
	}

	async updateStateId(eventId: string, stateId: string): Promise<void> {
		const collection = await this.getCollection();
		await collection.updateOne({ eventId: eventId }, { $set: { stateId } });
	}

	// finds events not yet referenced by other events
	// more on the respective adr
	async findPrevEvents(roomId: string) {
		const collection = await this.getCollection();
		return collection
			.find({ nextEventId: '', 'event.room_id': roomId })
			.toArray();
	}

	async persistEvent(event: EventBase, eventId: string, stateId: string) {
		const collection = await this.getCollection();

		try {
			// @ts-ignore ??? need to unify the typings
			await collection.insertOne({
				// @ts-ignore ???
				eventId: eventId,
				event: event,
				stateId: stateId,
				createdAt: new Date(),
				nextEventId: '', // new events are not expected to have forward edges
				// _id: undefined,
			});
		} catch (e) {
			if (e instanceof MongoError) {
				if (e.code === 11000) {
					// duplicate key error
					// this is expected, if the same intentional event is attempted to be persisted again
					return;
				}
			}

			throw e;
		}

		// this must happen later to as to avoid finding 0 prev_events on a parallel request
		await collection.updateMany(
			{ eventId: { $in: event.prev_events as string[] } },
			{ $set: { nextEventId: eventId } },
		);

		return eventId;
	}
}
