import { generateId } from '@hs/core';
import type { EventStagingStore } from '@hs/core';
import { type EventID, Pdu } from '@hs/room';
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
		pendingInvite = false,
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
					pendingInvite,
				},
			},
			{
				upsert: true,
			},
		);
	}

	removeByEventId(eventId: EventID): Promise<DeleteResult> {
		return this.collection.deleteOne({ _id: eventId });
	}

	getNextStagedEventForRoom(roomId: string): Promise<EventStagingStore | null> {
		return this.collection.findOne(
			{
				roomId,
				pendingInvite: false,
			},
			{
				sort: { createdAt: 1 },
			},
		);
	}

	async getDistinctStagedRooms(): Promise<string[]> {
		return this.collection.distinct('roomId');
	}

	async unmarkInvitePending(eventId: EventID): Promise<UpdateResult> {
		return this.collection.updateOne(
			{ _id: eventId },
			{ $set: { pendingInvite: false } },
		);
	}
}
