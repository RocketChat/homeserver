import { ServerKey } from '@hs/core';
import { Collection, Filter, FindOptions } from 'mongodb';
import { inject, singleton } from 'tsyringe';

@singleton()
export class KeyRepository {
	constructor(
		@inject('KeyCollection') private readonly collection: Collection<ServerKey>,
	) {}

	async findByServerName(
		serverName: string,
		validUntil?: number,
	): Promise<ServerKey | null> {
		return this.collection.findOne({
			serverName,
			...(validUntil ? { 'keys.expiresAt': { $gt: validUntil } } : {}),
		});
	}

	async findByServerNameAndKeyId(
		serverName: string,
		keyId: string,
		validUntil?: number,
	): Promise<ServerKey | null> {
		return this.collection.findOne({
			serverName,
			[`keys.${keyId}`]: { $exists: true },
			...(validUntil
				? { [`keys.${keyId}.expiresAt`]: { $gte: validUntil } }
				: {}),
		});
	}

	async findAllByServerNameAndKeyIds(
		serverName: string,
		keyIds: string[],
	): Promise<ServerKey | null> {
		const query: Filter<ServerKey> = {
			serverName,
		};

		for (const keyId of keyIds) {
			query[`keys.${keyId}`] = { $exists: true };
		}

		return this.collection.findOne(query);
	}

	async storeKeys(serverKey: ServerKey): Promise<void> {
		await this.collection.updateOne(
			{ serverName: serverKey.serverName },
			{ $set: serverKey },
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
