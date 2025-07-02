import { injectable } from 'tsyringe';
import type { Collection, Filter, FindCursor, FindOptions } from 'mongodb';
import { generateId } from '@hs/core';
import type { EventBaseWithOptionalId, EventStore } from '@hs/core';
import { DatabaseConnectionService } from '../services/database-connection.service';
import { MongoError } from 'mongodb';

@injectable()
export class EventRepository {
	private collection: Collection<EventStore> | null = null;

	constructor(private readonly dbConnection: DatabaseConnectionService) {
		this.getCollection();
	}

	async getCollection(): Promise<Collection<EventStore>> {
		const db = await this.dbConnection.getDb();
		this.collection = db.collection<EventStore>('events');
		return this.collection!;
	}

	async findById(eventId: string): Promise<EventStore | null> {
		const collection = await this.getCollection();
		return collection.findOne({ _id: eventId });
	}

	async findByIds(eventIds: string[]): Promise<EventStore[]> {
		if (!eventIds.length) return [];

		const collection = await this.getCollection();
		return collection.find({ _id: { $in: eventIds } }).toArray();
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
			.find({ 'event.room_id': roomId, _id: { $in: eventIds } })
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
		event: EventBaseWithOptionalId,
		eventId?: string,
		args?: object,
		stateId = '',
	): Promise<string> {
		const collection = await this.getCollection();
		const id = eventId || event.event_id || generateId(event);

		try {
			await collection.insertOne({
				_id: id,
				event,
				stateId,
				createdAt: new Date(),
				...(args || {}),
			});

			return id;
		} catch (e) {
			if (e instanceof MongoError) {
				if (e.code === 11000) {
					// duplicate key error
					// this is expected, if the same intentional event is attempted to be persisted again
					return id;
				}
			}

			throw e;
		}
	}

	async createIfNotExists(event: EventBaseWithOptionalId): Promise<string> {
		const collection = await this.getCollection();
		const id = event.event_id || generateId(event);

		const existingEvent = await collection.findOne({ _id: id });
		if (existingEvent) return id;

		await collection.insertOne({
			_id: id,
			event,
			stateId: '',
			createdAt: new Date(),
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
			_id: id,
			event,
			stateId: '',
			staged: true,
			createdAt: new Date(),
		});

		return id;
	}

	async redactEvent(
		eventId: string,
		redactedEvent: EventBaseWithOptionalId,
	): Promise<void> {
		const collection = await this.getCollection();

		await collection.updateOne(
			{ _id: eventId },
			{ $set: { event: redactedEvent } }, // Purposefully replacing the entire event
		);
	}

	async upsert(event: EventBaseWithOptionalId): Promise<string> {
		const collection = await this.getCollection();
		const id = event.event_id || generateId(event);

		await collection.updateOne(
			{ _id: id },
			{ $set: { _id: id, event } },
			{ upsert: true },
		);

		return id;
	}

	async removeFromStaging(roomId: string, eventId: string): Promise<void> {
		const collection = await this.getCollection();
		await collection.updateOne(
			{ _id: eventId, 'event.room_id': roomId },
			{ $unset: { staged: 1 } },
		);
	}

	async findOldestStaged(roomId: string): Promise<EventStore | null> {
		const collection = await this.getCollection();
		return collection.findOne(
			{ 'event.room_id': roomId, staged: true },
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
			{ sort: { 'event.origin_server_ts': -1 } },
		);
	}

	async findEventsByRoomIdAfterTimestamp(
		roomId: string,
		timestamp: number,
	): Promise<FindCursor<EventStore>> {
		const collection = await this.getCollection();
		return collection.find({
			'event.room_id': roomId,
			'event.origin_server_ts': { $gt: timestamp },
		});
	}

	async updateStateId(eventId: string, stateId: string): Promise<void> {
		const collection = await this.getCollection();
		await collection.updateOne({ _id: eventId }, { $set: { stateId } });
	}
}
