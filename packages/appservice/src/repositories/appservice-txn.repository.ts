import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

import type { AppServiceTransaction } from '../models/appservice.model';

@singleton()
export class AppServiceTransactionRepository {
	constructor(
		@inject('AppServiceTxnCollection')
		private readonly collection: Collection<AppServiceTransaction>,
	) {
		this.collection.createIndex({ asId: 1, txnId: 1 }, { unique: true });
	}

	async create(txn: AppServiceTransaction): Promise<void> {
		await this.collection.insertOne(txn);
	}

	async getOldestPending(asId: string): Promise<AppServiceTransaction | null> {
		return this.collection.findOne({ asId }, { sort: { txnId: 1 } });
	}

	async complete(asId: string, txnId: number): Promise<void> {
		await this.collection.deleteOne({ asId, txnId });
	}

	async removeAll(asId: string): Promise<void> {
		await this.collection.deleteMany({ asId });
	}
}
