import {
	type Collection,
	Filter,
	FindCursor,
	type InsertOneResult,
	ObjectId,
	type WithId,
} from 'mongodb';
import { inject, singleton } from 'tsyringe';

import type { EventID, StateMapKey } from '@hs/room';
import type { PersistentEventBase } from '@hs/room';

export type StateStore = {
	_id: ObjectId;
	delta: {
		identifier: StateMapKey;
		eventId: EventID;
	};

	createdAt: Date;
	roomId: string;

	prevStateIds: string[];
};

@singleton()
export class StateRepository {
	constructor(
		@inject('StateCollection')
		private readonly collection: Collection<WithId<StateStore>>,
	) {}
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

	getStateMappingsByRoomIdOrderedAscending(
		roomId: string,
	): FindCursor<WithId<StateStore>> {
		return this.collection.find({ roomId }).sort({ createdAt: 1 });
	}

	getStateMappingsByStateIdsOrdered(
		stateIds: string[],
	): FindCursor<WithId<StateStore>> {
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

	getByRoomIdsAndIdentifier(
		roomIds: string[],
		identifier: string | RegExp,
	): FindCursor<WithId<StateStore>> {
		return this.collection.find({
			roomId: { $in: roomIds },
			'delta.identifier': identifier,
		});
	}

	getStateMappingsByIdentifier(
		identifier: string,
	): FindCursor<WithId<StateStore>> {
		// TODO: why it must to end whit `:` ?
		return this.collection.find({ 'delta.identifier': identifier });
	}
}
