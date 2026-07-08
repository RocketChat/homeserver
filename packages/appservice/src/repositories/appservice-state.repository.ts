import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

import type { AppServiceState } from '../models/appservice.model';

@singleton()
export class AppServiceStateRepository {
	constructor(
		@inject('AppServiceStateCollection')
		private readonly collection: Collection<AppServiceState>,
	) {}

	async getState(asId: string): Promise<AppServiceState | null> {
		return this.collection.findOne({ _id: asId });
	}

	async upsertState(asId: string, updates: Partial<Omit<AppServiceState, '_id'>>): Promise<void> {
		const set: Record<string, unknown> = { updatedAt: new Date() };
		const unset: Record<string, 1> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value === undefined) {
				unset[key] = 1;
			} else {
				set[key] = value;
			}
		}

		await this.collection.updateOne(
			{ _id: asId },
			{
				$set: set,
				...(Object.keys(unset).length > 0 && { $unset: unset }),
				$setOnInsert: { _id: asId, lastTxnId: 0, streamOrdering: 0, readReceiptStreamId: 0, presenceStreamId: 0, toDeviceStreamId: 0 },
			},
			{ upsert: true },
		);
	}

	async markUp(asId: string): Promise<void> {
		await this.upsertState(asId, {
			state: 'up',
			lastError: undefined,
			lastErrorAt: undefined,
		});
	}

	async markDown(asId: string, error: string): Promise<void> {
		await this.upsertState(asId, {
			state: 'down',
			lastError: error,
			lastErrorAt: new Date(),
		});
	}

	async incrementTxnId(asId: string): Promise<number> {
		const result = await this.collection.findOneAndUpdate(
			{ _id: asId },
			{
				$inc: { lastTxnId: 1 },
				$set: { updatedAt: new Date() },
				$setOnInsert: {
					_id: asId,
					state: 'up' as const,
					streamOrdering: 0,
					readReceiptStreamId: 0,
					presenceStreamId: 0,
					toDeviceStreamId: 0,
				},
			},
			{ upsert: true, returnDocument: 'after' },
		);
		return result?.lastTxnId ?? 1;
	}

	async remove(asId: string): Promise<void> {
		await this.collection.deleteOne({ _id: asId });
	}
}
