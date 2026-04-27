import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

import type { AppServiceRegistration } from '../models/appservice.model';

@singleton()
export class AppServiceRepository {
	constructor(
		@inject('AppServiceCollection')
		private readonly collection: Collection<AppServiceRegistration>,
	) {
		this.collection.createIndex({ asToken: 1 }, { unique: true });
	}

	async findAll(): Promise<AppServiceRegistration[]> {
		return this.collection.find().toArray();
	}

	async upsert(registration: AppServiceRegistration): Promise<void> {
		await this.collection.updateOne({ _id: registration._id }, { $set: registration }, { upsert: true });
	}

	async remove(id: string): Promise<boolean> {
		const result = await this.collection.deleteOne({ _id: id });
		return result.deletedCount > 0;
	}
}
