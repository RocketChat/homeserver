import type { EventBase } from '@rocket.chat/federation-core';
import type { EventID } from '@rocket.chat/federation-room';
import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type Room = {
	_id: string;
	room: {
		name: string;
		join_rules: string;
		version: string;
		alias?: string;
		canonical_alias?: string;
		deleted?: boolean;
		tombstone_event_id?: EventID;
	};
};

@singleton()
export class RoomRepository {
	constructor(@inject('RoomCollection') private readonly collection: Collection<Room>) {}

	async upsert(roomId: string, state: EventBase[]) {
		await this.collection.findOneAndUpdate(
			{ _id: roomId },
			{
				$set: {
					_id: roomId,
					state,
				},
			},
			{ upsert: true },
		);
	}

	public async findOneById(roomId: string): Promise<Room | null> {
		return this.collection.findOne({ _id: roomId });
	}

	async markRoomAsDeleted(roomId: string, tombstoneEventId: string): Promise<void> {
		await this.collection.updateOne(
			{ _id: roomId },
			{
				$set: {
					'room.deleted': true,
					'room.tombstone_event_id': tombstoneEventId,
				},
			},
		);
	}
}
