import {
	type EventID,
	type PduType,
	type PersistentEventBase,
	RoomID,
	type StateID,
	type StateMapKey,
	getStateMapKey,
} from '@rocket.chat/federation-room';
import { type Collection, ObjectId } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type StateGraphStore = {
	_id: StateID;
	roomId: string;
	type: PduType;
	stateKey: string;
	eventId: EventID;

	previousNode: StateID;
	chainId: string;
	depth: number;

	createdAt: Date;

	partial: boolean;
};

@singleton()
export class StateGraphRepository {
	constructor(
		@inject('StateGraphCollection')
		private readonly collection: Collection<StateGraphStore>,
	) {}

	private async _buildPreviousStateMapById(
		stateId: StateID,
	): Promise<Map<StateMapKey, EventID>> {
		const result = await this.collection
			.aggregate<{ stateMap: Record<StateMapKey, EventID> }>([
				{ $match: { _id: stateId } },
				{
					$graphLookup: {
						from: this.collection.collectionName,
						startWith: '$previousNode',
						connectFromField: 'previousNode',
						connectToField: '_id',
						as: 'maps',
					},
				},
				{
					$project: {
						stateMap: {
							$arrayToObject: {
								$map: {
									input: {
										$sortArray: {
											input: '$maps',
											sortBy: { depth: 1 },
										},
									},
									as: 'doc',
									in: {
										k: { $concat: ['$$doc.type', ':', '$$doc.stateKey'] },
										v: '$$doc.eventId',
									},
								},
							},
						},
					},
				},
			])
			.toArray();

		if (result.length === 0) {
			return new Map<StateMapKey, EventID>();
		}

		return new Map(
			Object.entries(result[0].stateMap) as [StateMapKey, EventID][],
		);
	}

	async buildPreviousStateMapById(
		stateId: StateID,
	): Promise<Map<StateMapKey, EventID> | null> {
		const current = await this.collection.findOne({ _id: stateId });
		if (!current) {
			return null;
		}

		return this._buildPreviousStateMapById(stateId);
	}

	async buildStateMapById(
		stateId: StateID,
	): Promise<Map<StateMapKey, EventID> | null> {
		const current = await this.collection.findOne({ _id: stateId });
		if (!current) {
			return null;
		}

		const stateMap = await this._buildPreviousStateMapById(stateId);
		if (!stateMap) {
			return null;
		}

		stateMap.set(
			getStateMapKey({ type: current.type, state_key: current.stateKey }),
			current.eventId,
		);

		return stateMap;
	}

	async createSnapshot(events: PersistentEventBase[]) {
		const sorted = events.sort((e1, e2) => {
			const e1Depth = e1.depth;
			const e2Depth = e2.depth;
			if (e1Depth !== e2Depth) {
				return e1Depth - e2Depth;
			}

			if (e1.originServerTs !== e2.originServerTs) {
				return e1.originServerTs - e2.originServerTs;
			}

			return e1.eventId.localeCompare(e2.eventId);
		});

		const [create, ...rest] = sorted;
		if (!create) {
			throw new Error(
				'StateGraphReposiory: no create event in state snapshot to be saved',
			);
		}

		let previousStateId = await this.createDelta(create, '' as StateID);
		for (const event of rest) {
			previousStateId = await this.createDelta(event, previousStateId);
		}

		return previousStateId;
	}

	async findChainIdByStateId(stateId: StateID) {
		const doc = await this.collection.findOne(
			{ _id: stateId },
			{ projection: { chainId: 1 } },
		);
		if (!doc) {
			throw new Error(`No chain id for existing state id ${stateId}`);
		}

		return doc.chainId;
	}

	async findOneById(stateId: StateID) {
		return this.collection.findOne({ _id: stateId });
	}

	async findOneByPreviousNode(stateId: StateID) {
		return this.collection.findOne({ previousNode: stateId });
	}

	async createDelta(
		event: PersistentEventBase,
		previousStateId: StateID,
	): Promise<StateID> {
		const stateId = new ObjectId().toString() as StateID;

		const previousDelta = await this.findOneById(previousStateId);

		const depth = previousDelta ? previousDelta.depth + 1 : 0;

		const nextDelta = await this.findOneByPreviousNode(previousStateId);

		let chainId = '' as StateGraphStore['chainId'];
		if (previousDelta) {
			// new chain or use existing
			chainId = nextDelta ? new ObjectId().toString() : previousDelta.chainId;
		} else {
			chainId = new ObjectId().toString();
		}

		const partial = event.isPartial() || (previousDelta?.partial ?? false);

		await this.collection.insertOne({
			_id: stateId,
			createdAt: new Date(),
			roomId: event.roomId,
			type: event.type,
			stateKey: event.stateKey as string,
			eventId: event.eventId,
			previousNode: previousStateId,
			chainId,
			depth,
			partial,
		});

		return stateId;
	}

	findByStateIds(stateIds: StateID[]) {
		return this.collection.find({ _id: { $in: stateIds } });
	}

	async findLatestByStateIds(stateIds: StateID[]) {
		return this.collection.findOne(
			{ _id: { $in: stateIds } },
			{ sort: { depth: -1 } },
		);
	}

	findByEventIds(eventIds: EventID[]) {
		return this.collection.find({ eventId: { $in: eventIds } });
	}

	findLatestByChainIdAndEventIds(chainId: string, eventIds: EventID[]) {
		return this.collection.findOne(
			{ chainId, eventId: { $in: eventIds } },
			{ sort: { depth: -1 } },
		);
	}
}
