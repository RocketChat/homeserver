import { type EventID, Pdu } from '@rocket.chat/federation-room';
import type { EventStagingStore } from '@hs/core';
import type { Collection, DeleteResult, UpdateResult } from 'mongodb';
import { inject, singleton } from 'tsyringe';

@singleton()
export class EventStagingRepository {
	constructor(
		@inject('EventStagingCollection')
		private readonly collection: Collection<EventStagingStore>,
	) {
		this.collection.createIndex({
			roomId: 1,
			got: 1,
			'event.depth': 1,
			createdAt: 1,
		});
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
					got: 0,
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
		return this.collection.findOneAndUpdate(
			{ roomId },
			{
				$inc: {
					got: 1,
				},
			},
			{
				sort: { got: 1, 'event.depth': 1, createdAt: 1 },
				upsert: false,
				returnDocument: 'before',
			},
		);
	}

	removeByEventId(eventId: EventID): Promise<DeleteResult> {
		return this.collection.deleteOne({ _id: eventId });
	}

	async getDistinctStagedRooms(): Promise<string[]> {
		return this.collection.distinct('roomId');
	}
}
