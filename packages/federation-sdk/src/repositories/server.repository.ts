import { Collection } from 'mongodb';
import { singleton } from 'tsyringe';
import { DatabaseConnectionService } from '../services/database-connection.service';

type Server = {
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
	private collection!: Collection<Server>;

	constructor(private readonly dbConnection: DatabaseConnectionService) {
		this.getCollection();
	}

	private async getCollection(): Promise<Collection<Server>> {
		const db = await this.dbConnection.getDb();
		this.collection = db.collection<Server>('servers');
		return this.collection;
	}

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
