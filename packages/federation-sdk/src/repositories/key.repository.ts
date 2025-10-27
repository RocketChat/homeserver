import { ServerKey } from '@hs/core';
import type { Collection, Filter, FindCursor, FindOptions } from 'mongodb';
import { inject, singleton } from 'tsyringe';

@singleton()
export class KeyRepository {
	constructor(
		@inject('KeyCollection') private readonly collection: Collection<ServerKey>,
	) {}

	findByServerName(
		serverName: string,
		validUntil?: Date,
		options?: FindOptions<ServerKey>,
	): FindCursor<ServerKey> {
		return this.collection.find(
			{
				serverName,
				...(validUntil && { expiresAt: { $gt: validUntil } }),
			},
			options ?? {},
		);
	}

	async findByServerNameAndKeyId(
		serverName: string,
		keyId: string,
		validUntil?: Date,
		options?: FindOptions<ServerKey>,
	): Promise<ServerKey | null> {
		return this.collection.findOne(
			{
				serverName,
				keyId,
				...(validUntil && { expiresAt: { $gte: validUntil } }),
			},
			options ?? {},
		);
	}

	findAllByServerNameAndKeyIds(
		serverName: string,
		keyIds: string[],
		options?: FindOptions<ServerKey>,
	): FindCursor<ServerKey> {
		const query: Filter<ServerKey> = {
			serverName,
			keyId: { $in: keyIds },
		};

		return this.collection.find(query, options ?? {});
	}

	// cache can be refreshed
	async insertOrUpdateKey(serverKey: ServerKey): Promise<void> {
		await this.collection.updateOne(
			{ serverName: serverKey.serverName, keyId: serverKey.keyId },
			{
				$setOnInsert: {
					_createdAt: new Date(),
					// following shouldn't change along with keyId
					key: serverKey.key,
					pem: serverKey.pem,
				},
				$set: {
					expiresAt: serverKey.expiresAt,
					_updatedAt: new Date(),
				},
			},
			{ upsert: true },
		);
	}

	async storePublicKey(
		origin: string,
		keyId: string,
		publicKey: string,
		validUntil?: Date,
	): Promise<void> {
		await this.collection.updateOne(
			{ origin, key_id: keyId },
			{
				$set: {
					origin,
					key_id: keyId,
					public_key: publicKey,
					valid_until: validUntil || new Date(Date.now() + 24 * 60 * 60 * 1000), // Default 24 hours validity
					updated_at: new Date(),
				},
			},
			{ upsert: true },
		);
	}

	async getValidPublicKeyFromLocal(
		origin: string,
		keyId: string,
	): Promise<string | undefined> {
		const key = await this.collection.findOne({
			origin,
			key_id: keyId,
			valid_until: { $gt: new Date() },
		});

		// @ts-ignore
		return key?.public_key;
	}
}
