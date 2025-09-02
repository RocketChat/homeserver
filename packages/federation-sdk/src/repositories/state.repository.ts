import {
	type Collection,
	Filter,
	FindCursor,
	type InsertOneResult,
	ObjectId,
	type WithId,
} from 'mongodb';
import { singleton } from 'tsyringe';
import { DatabaseConnectionService } from '../services/database-connection.service';

import type { StateMapKey } from '@hs/room';
import type { PersistentEventBase } from '@hs/room';

type StateStore = {
	_id: ObjectId;
	delta: {
		identifier: StateMapKey;
		eventId: string;
	};
	roomId: string;
	prevStateIds: string[];
	createdAt: Date;
};

@singleton()
export class StateRepository {
	private collection!: Collection<StateStore>;

	constructor(private readonly dbConnection: DatabaseConnectionService) {
		this.getCollection();
	}

	async find(query: Filter<StateStore>): Promise<FindCursor<StateStore>> {
		return this.collection.find(query);
	}

	private async getCollection(): Promise<Collection<StateStore>> {
		const db = await this.dbConnection.getDb();
		this.collection = db.collection<StateStore>('states');
		return this.collection;
	}

	async getStateById(stateId: string): Promise<StateStore | null> {
		return this.collection.findOne({ _id: new ObjectId(stateId) });
	}

	async getLatestStateMapping(roomId: string): Promise<StateStore | null> {
		return this.collection.findOne({ roomId }, { sort: { createdAt: 1 } });
	}

	async getLastStateMappingByRoomId(
		roomId: string,
	): Promise<StateStore | null> {
		return this.collection.findOne({ roomId }, { sort: { createdAt: -1 } });
	}

	async getStateMappingsByRoomIdOrderedAscending(
		roomId: string,
	): Promise<FindCursor<StateStore>> {
		return this.collection.find({ roomId }).sort({ createdAt: 1 });
	}

	async getStateMappingsByStateIdsOrdered(
		stateIds: string[],
	): Promise<FindCursor<StateStore>> {
		return this.collection
			.find({ _id: { $in: stateIds.map((id) => new ObjectId(id)) } })
			.sort({ createdAt: 1 /* order as is saved */ });
	}

	async getByRoomIdAndIdentifier(
		roomId: string,
		identifier: string,
	): Promise<StateStore | null> {
		return this.collection.findOne({ roomId, 'delta.identifier': identifier });
	}

	async createStateMapping(
		event: PersistentEventBase,
		prevStateIds: string[] = [],
	): Promise<InsertOneResult<StateStore>> {
		return this.collection.insertOne({
			_id: new ObjectId(),
			delta: {
				identifier: event.getUniqueStateIdentifier(),
				eventId: event.eventId,
			},
			createdAt: new Date(),
			roomId: event.roomId,
			prevStateIds,
		});
	}

	async getByRoomIdsAndIdentifier(
		roomIds: string[],
		identifier: string | RegExp,
	): Promise<FindCursor<StateStore>> {
		return this.collection.find({
			roomId: { $in: roomIds },
			'delta.identifier': identifier,
		});
	}

	async getStateMappingsByIdentifier(
		identifier: string,
	): Promise<FindCursor<StateStore>> {
		return this.collection.find({ 'delta.identifier': identifier });
	}
}
