import { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type Key = {
	origin: string;
	key_id: string;
	public_key: string;
	valid_until: Date;
};

@singleton()
export class KeyRepository {
	constructor(
		@inject('KeyCollection') private readonly collection: Collection<Key>,
	) {}

	async getValidPublicKeyFromLocal(
		origin: string,
		keyId: string,
	): Promise<string | undefined> {
		const key = await this.collection.findOne({
			origin,
			key_id: keyId,
			valid_until: { $gt: new Date() },
		});

		return key?.public_key;
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
}
