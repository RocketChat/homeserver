import type { EventBase } from '@hs/core';
import { Collection } from 'mongodb';
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
		tombstone_event_id?: string;
	};
};

@singleton()
export class RoomRepository {
	constructor(
		@inject('RoomCollection') private readonly collection: Collection<Room>,
	) {}

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

	async insert(
		roomId: string,
		props: { name?: string; canonicalAlias?: string; alias?: string },
	): Promise<void> {
		await this.collection.insertOne({
			_id: roomId,
			room: {
				name: props.name || '',
				join_rules: 'public',
				version: '1',
				alias: props.alias || '',
				canonical_alias: props.canonicalAlias || '',
			},
		});
	}

	async getRoomVersion(roomId: string): Promise<string | null> {
		const room = await this.collection.findOne(
			{ _id: roomId },
			{ projection: { version: 1 } },
		);
		return room?.room.version || null;
	}

	async updateRoomName(roomId: string, name: string): Promise<void> {
		await this.collection.updateOne(
			{ room_id: roomId },
			{ $set: { name: name } },
			{ upsert: false },
		);
	}
	public async findOneById(roomId: string): Promise<Room | null> {
		return this.collection.findOne({ _id: roomId });
	}

	async markRoomAsDeleted(
		roomId: string,
		tombstoneEventId: string,
	): Promise<void> {
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
