import { injectable } from 'tsyringe';
import {
	FindCursor,
	type InsertOneResult,
	ObjectId,
	type Collection,
	type WithId,
} from 'mongodb';
import type { DatabaseConnectionService } from '../services/database-connection.service';

import type { StateMapKey } from '@hs/room/src/types/_common';
import { PersistentEventBase } from '@hs/room/src/manager/event-wrapper';

type StateStore = {
	delta: {
		[key: StateMapKey]: string;
	};

	createdAt: Date;

	prevStateIds: string[];
};

@injectable()
export class StateRepository {
	private collection: Collection<WithId<StateStore>> | null = null;

	constructor(private readonly dbConnection: DatabaseConnectionService) {
		this.getCollection();
	}

	async getCollection(): Promise<Collection<WithId<StateStore>>> {
		const db = await this.dbConnection.getDb();
		this.collection = db.collection<WithId<StateStore>>('states');
		return this.collection;
	}

	async getStateMapping(stateId: string): Promise<WithId<StateStore> | null> {
		const collection = await this.getCollection();
		return collection.findOne({ _id: new ObjectId(stateId) });
	}

	async getStateMappingsByRoomIdOrdered(
		roomId: string,
	): Promise<FindCursor<WithId<StateStore>>> {
		const collection = await this.getCollection();
		return collection.find({ roomId }).sort({ createdAt: -1 });
	}

	async getStateMappingsByStateIdsOrdered(
		stateIds: string[],
	): Promise<FindCursor<WithId<StateStore>>> {
		const collection = await this.getCollection();
		return collection
			.find({ _id: { $in: stateIds.map((id) => new ObjectId(id)) } })
			.sort({ createdAt: -1 });
	}

	async createStateMapping(
		event: PersistentEventBase,
		prevStateIds: string[] = [],
	): Promise<InsertOneResult<WithId<StateStore>>> {
		const delta = { [event.getUniqueStateIdentifier()]: event.eventId };

		const collection = await this.getCollection();

		return collection.insertOne({
			_id: new ObjectId(),
			delta,
			createdAt: new Date(),
			prevStateIds,
		});
	}
}
