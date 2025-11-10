import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type User = {
	_id: string;
	username?: string;
	name?: string;
	avatarUrl?: string;
	avatarETag?: string;
	federated?: boolean;
	federation?: {
		version?: number;
		mui?: string;
		origin?: string;
		avatarUrl?: string;
	};
	createdAt: Date;
	_updatedAt: Date;
};

@singleton()
export class UserRepository {
	constructor(
		@inject('UserCollection') private readonly collection: Collection<User>,
	) {}

	async findByUsername(username: string): Promise<User | null> {
		return this.collection.findOne(
			{
				username,
				$or: [{ federated: { $exists: false } }, { federated: false }],
			},
			{
				projection: {
					_id: 1,
					username: 1,
					name: 1,
					avatarUrl: 1,
					avatarETag: 1,
					federation: 1,
					federated: 1,
					createdAt: 1,
					_updatedAt: 1,
				},
			},
		);
	}
}
