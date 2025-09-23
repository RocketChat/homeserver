import { generateId } from '@rocket.chat/federation-core';
import type { EventBase, EventStore } from '@rocket.chat/federation-core';
import {
	type EventID,
	Pdu,
	PduForType,
	PduType,
} from '@rocket.chat/federation-room';
import type {
	Collection,
	Filter,
	FindCursor,
	FindOptions,
	UpdateResult,
	WithId,
} from 'mongodb';
import { MongoError } from 'mongodb';
import { inject, singleton } from 'tsyringe';

@singleton()
export class EventRepository {
	constructor(
		@inject('EventCollection')
		private readonly collection: Collection<EventStore>,
	) {}

	async findById(eventId: EventID): Promise<EventStore | null> {
		return this.collection.findOne({ _id: eventId });
	}

	findAuthEvents(
		eventType: string,
		roomId: string,
		senderId: string,
	): FindCursor<EventStore> {
		const baseQueries = {
			create: {
				query: { 'event.room_id': roomId, 'event.type': 'm.room.create' },
			},
			powerLevels: {
				query: {
					'event.room_id': roomId,
					'event.type': 'm.room.power_levels',
				},
			},
			membership: {
				query: {
					'event.room_id': roomId,
					'event.type': 'm.room.member',
					'event.state_key': senderId,
					'event.content.membership': 'join',
				},
			},
		};

		let queries: { query: Record<string, unknown> }[] = [];
		switch (eventType) {
			case 'm.room.name':
				queries = [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];
				break;

			case 'm.room.message':
				queries = [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];
				break;

			case 'm.reaction':
				queries = [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];
				break;

			case 'm.room.member':
				queries = [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];
				break;

			case 'm.room.create':
				queries = [baseQueries.create];
				break;

			case 'm.room.power_levels':
				queries = [
					baseQueries.create,
					baseQueries.powerLevels,
					baseQueries.membership,
				];
				break;

			case 'm.room.redaction':
				queries = [baseQueries.create, baseQueries.powerLevels];
				break;

			default:
				throw new Error(`Unsupported event type: ${eventType}`);
		}

		return this.collection.find({ $or: queries.map((q) => q.query) });
	}

	findByRoomId(roomId: string): FindCursor<EventStore> {
		return this.collection.find(
			{ 'event.room_id': roomId },
			{ sort: { 'event.depth': 1 } },
		);
	}

	async create(
		origin: string,
		event: Pdu,
		eventId: EventID,
		stateId = '',
	): Promise<string | undefined> {
		return this.persistEvent(origin, event, eventId, stateId);
	}

	async redactEvent(eventId: EventID, redactedEvent: Pdu): Promise<void> {
		await this.collection.updateOne(
			{ _id: eventId },
			{ $set: { event: redactedEvent } }, // Purposefully replacing the entire event
		);
	}

	async upsert(event: Pdu): Promise<string> {
		const id = generateId(event);

		await this.collection.updateOne(
			{ _id: id },
			// TODO: _id is really required here?
			{ $set: { _id: id, event } },
			{ upsert: true },
		);

		return id;
	}

	public async findPowerLevelsEventByRoomId(
		roomId: string,
	): Promise<EventStore<PduForType<'m.room.power_levels'>> | null> {
		return this.collection.findOne({
			'event.room_id': roomId,
			'event.type': 'm.room.power_levels',
		}) as unknown as EventStore<PduForType<'m.room.power_levels'>> | null;
	}

	public async findAllJoinedMembersEventsByRoomId(
		roomId: string,
	): Promise<EventStore<PduForType<'m.room.member'>>[]> {
		return this.collection
			.find({
				'event.room_id': roomId,
				'event.type': 'm.room.member',
				'event.content.membership': 'join',
			})
			.toArray() as Promise<EventStore<PduForType<'m.room.member'>>[]>;
	}

	async findLatestEventByRoomIdBeforeTimestampWithAssociatedState(
		roomId: string,
		timestamp: number,
	): Promise<EventStore | null> {
		return this.collection.findOne(
			{
				'event.room_id': roomId,
				'event.origin_server_ts': { $lt: timestamp }, // events before passed timestamp
				stateId: { $ne: '' },
			},
			{
				sort: {
					createdAt: -1, // but fetch latest one that was persisted
				},
			},
		);
	}

	findEventsByRoomIdAfterTimestamp(
		roomId: string,
		timestamp: number,
	): FindCursor<EventStore> {
		return this.collection
			.find({
				'event.room_id': roomId,
				'event.origin_server_ts': { $gt: timestamp },
			})
			.sort({
				'event.origin_server_ts': 1,
			});
	}

	async updateStateId(eventId: EventID, stateId: string): Promise<void> {
		await this.collection.updateOne({ _id: eventId }, { $set: { stateId } });
	}

	// finds events not yet referenced by other events
	// more on the respective adr
	async findPrevEvents(roomId: string) {
		return this.collection
			.find({
				nextEventId: '',
				'event.room_id': roomId,
				_id: { $ne: '' as EventID },
			})
			.toArray();
	}

	private async persistEvent(
		origin: string,
		event: Pdu,
		eventId: EventID,
		stateId: string,
	) {
		try {
			await this.collection.insertOne({
				_id: eventId,
				origin,
				event: event,
				stateId: stateId,
				createdAt: new Date(),
				nextEventId: '', // new events are not expected to have forward edges
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
		await this.collection.updateMany(
			{ _id: { $in: event.prev_events } },
			{ $set: { nextEventId: eventId } },
		);

		return eventId;
	}

	findMembershipEventsFromDirectMessageRooms(
		users: string[],
	): FindCursor<EventStore<PduForType<'m.room.member'>>> {
		return this.collection.find({
			'event.type': 'm.room.member',
			'event.state_key': { $in: users },
			'event.content.membership': { $in: ['join', 'invite'] },
			'event.content.is_direct': true,
		}) as FindCursor<EventStore<PduForType<'m.room.member'>>>;
	}

	findTombstoneEventsByRoomId(roomId: string): FindCursor<EventStore> {
		return this.collection.find({
			'event.room_id': roomId,
			'event.type': 'm.room.tombstone',
			'event.state_key': '',
		});
	}

	findByIds<T extends PduType>(
		eventIds: EventID[],
	): FindCursor<WithId<EventStore<PduForType<T>>>> {
		return this.collection.find({
			_id: { $in: eventIds },
		}) as FindCursor<WithId<EventStore<PduForType<T>>>>;
	}

	findByRoomIdAndTypes(
		roomId: string,
		eventTypes: string[],
	): FindCursor<EventStore> {
		return this.collection.find({
			'event.room_id': roomId,
			'event.type': { $in: eventTypes },
		});
	}

	async setMissingDependencies(
		eventId: EventID,
		missingDependencies: EventStore['missing_dependencies'],
	): Promise<void> {
		await this.collection.updateOne(
			{ _id: eventId },
			{ $set: { missing_dependencies: missingDependencies } },
		);
	}

	findFromNonPublicRooms(eventIds: string[]): FindCursor<EventStore> {
		return this.collection.find({
			eventId: { $in: eventIds },
			'event.content.join_rule': { $ne: 'public' },
		});
	}

	async findByRoomIdAndType<T extends PduType>(
		roomId: string,
		eventType: T,
	): Promise<EventStore<PduForType<T>> | null> {
		return this.collection.findOne({
			'event.room_id': roomId,
			'event.type': eventType,
		}) as unknown as EventStore<PduForType<T>> | null;
	}

	findByRoomIdExcludingEventIds(
		roomId: string,
		eventIdsToExclude: EventID[],
		limit: number,
	): FindCursor<EventStore> {
		return this.collection.find(
			{
				'event.room_id': roomId,
				_id: { $nin: eventIdsToExclude },
			},
			{
				limit,
			},
		);
	}

	async findInviteEventsByRoomIdAndUserId(
		roomId: string,
		userId: string,
	): Promise<EventStore | null> {
		const result = this.collection.find(
			{
				'event.room_id': roomId,
				'event.type': 'm.room.member',
				'event.state_key': userId,
				'event.content.membership': 'invite',
			},
			{ limit: 1, sort: { 'event.origin_server_ts': -1 } },
		);
		return (await result.toArray())[0] ?? null;
	}

	async findLatestFromRoomId(roomId: string): Promise<EventStore | null> {
		return this.collection.findOne(
			{ 'event.room_id': roomId },
			{ sort: { 'event.depth': -1 } },
		);
	}

	findEventsByIdsWithDepth(
		roomId: string,
		eventIds: EventID[],
	): FindCursor<EventStore<Pick<Pdu, 'depth'>>> {
		return this.collection.find(
			{
				'event.room_id': roomId,
				_id: { $in: eventIds },
			},
			{ projection: { _id: 1, 'event.depth': 1 } },
		);
	}

	findEventsByRoomAndDepth(
		roomId: string,
		minDepth: number,
		maxDepth: number,
		excludeEventIds: string[],
		limit: number,
	): FindCursor<EventStore<Pdu>> {
		return this.collection
			.find(
				{
					'event.room_id': roomId,
					'event.depth': { $gte: minDepth, $lte: maxDepth },
					event_id: { $nin: excludeEventIds },
				},
				{
					projection: { event: 1 },
				},
			)
			.sort({ 'event.depth': 1 })
			.limit(limit);
	}
}
