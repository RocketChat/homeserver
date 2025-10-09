import { generateId } from '@rocket.chat/federation-core';
import type { EventStagingStore } from '@rocket.chat/federation-core';
import { type EventID, Pdu } from '@rocket.chat/federation-room';
import type { Collection, DeleteResult, UpdateResult } from 'mongodb';
import { inject, singleton } from 'tsyringe';

@singleton()
export class EventStagingRepository {
	constructor(
		@inject('EventStagingCollection')
		private readonly collection: Collection<EventStagingStore>,
	) {
		this.collection.createIndex({ roomId: 1, createdAt: 1 });
	}

	async create(
		eventId: EventID,
		origin: string,
		event: Pdu,
		from: 'join' | 'transaction' = 'transaction',
	): Promise<UpdateResult> {
		// We use an upsert here to handle the case where we see the same event
		// from the same server multiple times.
		return this.collection.updateOne(
			{
				_id: eventId,
				origin,
			},
			{
				$setOnInsert: {
					roomId: event.room_id,
					createdAt: new Date(),
				},
				$set: {
					event,
					from,
				},
			},
			{
				upsert: true,
			},
		);
	}

	getLeastDepthEventForRoom(roomId: string): Promise<EventStagingStore | null> {
		return this.collection.findOne(
			{ roomId },
			{ sort: { 'event.depth': 1, createdAt: 1 } },
		);
	}

	removeByEventId(eventId: EventID): Promise<DeleteResult> {
		return this.collection.deleteOne({ _id: eventId });
	}

	async getDistinctStagedRooms(): Promise<string[]> {
		return this.collection.distinct('roomId');
	}
}
