import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

import type { AppServiceTransaction } from '../models/appservice.model';

@singleton()
export class AppServiceTransactionRepository {
	constructor(
		@inject('AppServiceTxnCollection')
		private readonly collection: Collection<AppServiceTransaction>,
	) {}

	async create(txn: AppServiceTransaction): Promise<void> {
		await this.collection.insertOne(txn);
	}

	async markSent(asId: string, txnId: number): Promise<void> {
		await this.collection.updateOne({ asId, txnId }, { $set: { status: 'sent', sentAt: new Date() } });
	}

	async markFailed(asId: string, txnId: number): Promise<void> {
		await this.collection.updateOne({ asId, txnId }, { $set: { status: 'failed' }, $inc: { attempts: 1 } });
	}

	async getPending(asId: string): Promise<AppServiceTransaction[]> {
		return this.collection
			.find({ asId, status: { $in: ['pending', 'failed'] } })
			.sort({ txnId: 1 })
			.toArray();
	}
}
