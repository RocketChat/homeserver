import { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type Server = {
	name: string;
	keys: {
		[key: string]: {
			key: string;
			validUntil: number;
		};
	};
};

@singleton()
export class ServerRepository {
	constructor(
		@inject('ServerCollection') private readonly collection: Collection<Server>,
	) {}

	async getValidPublicKeyFromLocal(
		origin: string,
		key: string,
	): Promise<string | undefined> {
		const server = await this.collection.findOne({ name: origin });
		return server?.keys?.[key]?.key;
	}

	async storePublicKey(
		origin: string,
		key: string,
		value: string,
		validUntil: number,
	): Promise<void> {
		await this.collection.findOneAndUpdate(
			{ name: origin },
			{
				$set: {
					[`keys.${key}`]: {
						key: value,
						validUntil,
					},
				},
			},
			{ upsert: true },
		);
	}
}
