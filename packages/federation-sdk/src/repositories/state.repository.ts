import {
	type Collection,
	Filter,
	FindCursor,
	type InsertOneResult,
	ObjectId,
	type WithId,
} from 'mongodb';
import { singleton } from 'tsyringe';

import type { StateMapKey } from '@hs/room';
import type { PersistentEventBase } from '@hs/room';

type StateStore = {
	delta: {
		identifier: StateMapKey;
		eventId: string;
	};

	createdAt: Date;
	roomId: string;

	prevStateIds: string[];
};

@singleton()
export class StateRepository {
	constructor(private readonly collection: Collection<WithId<StateStore>>) {}
	async find(
		query: Filter<StateStore>,
	): Promise<FindCursor<WithId<StateStore>>> {
		const collection = await this.getCollection();
		return collection.find(query);
	}
	async getStateById(stateId: string): Promise<WithId<StateStore> | null> {
		return this.collection.findOne({ _id: new ObjectId(stateId) });
	}

	async getLatestStateMapping(
		roomId: string,
	): Promise<WithId<StateStore> | null> {
		return this.collection.findOne({ roomId }, { sort: { createdAt: 1 } });
	}

	async getLastStateMappingByRoomId(
		roomId: string,
	): Promise<WithId<StateStore> | null> {
		return this.collection.findOne({ roomId }, { sort: { createdAt: -1 } });
	}

	async getStateMappingsByRoomIdOrderedAscending(
		roomId: string,
	): Promise<FindCursor<WithId<StateStore>>> {
		return this.collection.find({ roomId }).sort({ createdAt: 1 });
	}

	async getStateMappingsByStateIdsOrdered(
		stateIds: string[],
	): Promise<FindCursor<WithId<StateStore>>> {
		return this.collection
			.find({ _id: { $in: stateIds.map((id) => new ObjectId(id)) } })
			.sort({ createdAt: 1 /* order as is saved */ });
	}

	async getByRoomIdAndIdentifier(
		roomId: string,
		identifier: string,
	): Promise<WithId<StateStore> | null> {
		return this.collection.findOne({ roomId, 'delta.identifier': identifier });
	}

	async createStateMapping(
		event: PersistentEventBase,
		prevStateIds: string[] = [],
	): Promise<InsertOneResult<WithId<StateStore>>> {
		const delta = {
			identifier: event.getUniqueStateIdentifier(),
			eventId: event.eventId,
		};

		return this.collection.insertOne({
			_id: new ObjectId(),
			delta,
			createdAt: new Date(),
			roomId: event.roomId,
			prevStateIds,
		});
	}

	async getByRoomIdsAndIdentifier(
		roomIds: string[],
		identifier: string | RegExp,
	): Promise<FindCursor<WithId<StateStore>>> {
		return this.collection.find({
			roomId: { $in: roomIds },
			'delta.identifier': identifier,
		});
	}

	async getStateMappingsByIdentifier(
		identifier: string,
	): Promise<FindCursor<WithId<StateStore>>> {
		return this.collection.find({ 'delta.identifier': identifier });
	}
}
