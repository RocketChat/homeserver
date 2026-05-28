import crypto from 'node:crypto';

import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type User = {
	_id: string;
	username?: string;
	name?: string;
	avatarUrl?: string;
	avatarETag?: string;
	federated?: boolean;
	appserviceId?: string;
	federation?: {
		version?: number;
		mui?: string;
		origin?: string;
		avatarUrl?: string;
		appserviceId?: string;
	};
	createdAt: Date;
	_updatedAt: Date;
};

@singleton()
export class UserRepository {
	constructor(@inject('UserCollection') private readonly collection: Collection<User>) {}

	async findByUsername(username: string): Promise<User | null> {
		return this.collection.findOne(
			{
				username,
				$or: [{ federated: { $exists: false } }, { federated: false }, { 'federation.appserviceId': { $exists: true } }],
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

	/**
	 * Idempotently create the bot user that represents an appservice
	 * (its `sender_localpart`). Safe to call on every load / boot — it
	 * preserves `createdAt` and only refreshes `_updatedAt` and the
	 * `appserviceId` linkage on subsequent calls.
	 */
	async ensureSenderUser(localpart: string, serverName: string, appserviceId: string): Promise<void> {
		const now = new Date();
		const username = `@${localpart}:${serverName}`;
		await this.collection.updateOne(
			{ 'federation.appserviceId': appserviceId },
			{
				$set: {
					username,
					name: username,
					type: 'user' as const,
					status: 'offline' as const,
					active: true,
					roles: ['federated-external'],
					requirePasswordChange: false,
					federated: true,
					federation: {
						version: 1,
						mui: username,
						origin: serverName,
						appserviceId,
					},
					_updatedAt: new Date(),
				},
				$setOnInsert: {
					_id: crypto.randomUUID(),
					createdAt: now,
				},
			},
			{ upsert: true },
		);
	}
}
