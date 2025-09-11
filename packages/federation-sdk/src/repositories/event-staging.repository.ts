import { generateId } from '@hs/core';
import type { EventStagingStore } from '@hs/core';
import { Pdu } from '@hs/room';
import type { Collection, DeleteResult } from 'mongodb';
import { inject, singleton } from 'tsyringe';

@singleton()
export class EventStagingRepository {
	constructor(
		@inject('EventStagingCollection')
		private readonly collection: Collection<EventStagingStore>,
	) {
		this.collection.createIndex({ roomId: 1, createdAt: 1 });
	}

	async create(origin: string, event: Pdu, eventId?: string): Promise<string> {
		const id = eventId ?? generateId(event);

		// We use an upsert here to handle the case where we see the same event
		// from the same server multiple times.
		await this.collection.updateOne(
			{
				_id: id,
				origin,
			},
			{
				$setOnInsert: {
					roomId: event.room_id,
					createdAt: new Date(),
				},
				$set: {
					event,
				},
			},
			{
				upsert: true,
			},
		);

		return id;
	}

	removeByEventId(eventId: string): Promise<DeleteResult> {
		return this.collection.deleteOne({ _id: eventId });
	}

	getNextStagedEventForRoom(roomId: string): Promise<EventStagingStore | null> {
		return this.collection.findOne(
			{
				roomId,
			},
			{
				sort: { createdAt: 1 },
			},
		);
	}

	async getDistinctStagedRooms(): Promise<string[]> {
		return this.collection.distinct('roomId');
	}
}
