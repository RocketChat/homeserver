import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type RoomAlias = {
	_id: string;
	roomId: string;
};

@singleton()
export class RoomAliasRepository {
	constructor(@inject('RoomAliasCollection') private readonly collection: Collection<RoomAlias>) {}

	async findByAlias(alias: string): Promise<RoomAlias | null> {
		return this.collection.findOne({ _id: alias });
	}

	async findByRoomId(roomId: string): Promise<RoomAlias[]> {
		return this.collection.find({ roomId }).toArray();
	}

	async upsert(alias: string, roomId: string): Promise<void> {
		await this.collection.updateOne({ _id: alias }, { $set: { _id: alias, roomId } }, { upsert: true });
	}

	// Atomically claim an alias. Returns false if it was already taken, so callers
	// can fail fast without a separate (racy) check-then-set.
	async reserve(alias: string, roomId: string): Promise<boolean> {
		const result = await this.collection.updateOne({ _id: alias }, { $setOnInsert: { roomId } }, { upsert: true });
		return result.upsertedCount === 1;
	}

	async delete(alias: string): Promise<boolean> {
		const result = await this.collection.deleteOne({ _id: alias });
		return result.deletedCount > 0;
	}
}
