import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

import type { AppServiceRegistration, AppServiceSource } from '../models/appservice.model';

@singleton()
export class AppServiceRepository {
	constructor(
		@inject('AppServiceCollection')
		private readonly collection: Collection<AppServiceRegistration>,
	) {
		this.collection.createIndex({ asToken: 1 }, { unique: true });
		this.collection.createIndex({ source: 1 });
	}

	async findAll(): Promise<AppServiceRegistration[]> {
		return this.collection.find().toArray();
	}

	async findBySource(source: AppServiceSource): Promise<AppServiceRegistration[]> {
		return this.collection.find({ source }).toArray();
	}

	async upsert(registration: AppServiceRegistration): Promise<void> {
		await this.collection.updateOne({ _id: registration._id }, { $set: registration }, { upsert: true });
	}

	async remove(id: string): Promise<boolean> {
		const result = await this.collection.deleteOne({ _id: id });
		return result.deletedCount > 0;
	}

	async removeBySource(source: AppServiceSource): Promise<string[]> {
		const removed = await this.collection.find({ source }, { projection: { _id: 1 } }).toArray();
		if (removed.length === 0) return [];
		await this.collection.deleteMany({ source });
		return removed.map((r) => r._id);
	}
}
