import { Inject, Injectable } from "@nestjs/common";
import type { Collection, FindCursor, WithId } from "mongodb";
import { DatabaseConnection } from "../database/database.connection";

// a key document is unique by the server_name and verify_keys.[key_id]

// this is almost the raw response from /key/v2/server
export type ServerKey = {
	// still valid for signing events
	old_verify_keys: Record<
		string,
		{
			expired_ts: number;
			key: string;
		}
	>;
	server_name: string;
	signatures: Record<string, Record<string, string>>;
	valid_until_ts: number;
	// only federation requests
	verify_keys: Record<
		string, // keyAlgo:algoVersion => KeyId
		{
			key: string;
		}
	>;
};

export type ServerKeyDocument = ServerKey & { _createdAt: Date };

@Injectable()
export class KeyRepository {
	private collection: Collection<ServerKeyDocument> | null = null;

	constructor(
		@Inject(DatabaseConnection)
		private readonly dbConnection: DatabaseConnection,
	) {}

	private async getCollection(): Promise<Collection<ServerKeyDocument>> {
		if (!this.collection && !this.dbConnection) {
			throw new Error("Database connection was not injected properly");
		}

		const db = await this.dbConnection.getDb();
		this.collection = db.collection<ServerKeyDocument>("keys");
		return this.collection;
	}

	async storeKey(key: ServerKey): Promise<void> {
		const collection = await this.getCollection();

		await collection.insertOne({
			...key,
			_createdAt: new Date(),
		});
	}

	async findKey(
		serverName: string,
		keyId: string,
		validUntil: number,
	): Promise<WithId<ServerKeyDocument> | null> {
		const collection = await this.getCollection();
		return collection.findOne(
			{
				server_name: serverName,
				[`verify_keys.${keyId}`]: { $exists: true },
				valid_until_ts: { $lte: validUntil },
			},
			{ sort: { valid_until_ts: -1 } },
		);
	}
	async findKeys(
		serverName: string,
		keyId?: string,
		validUntil?: number,
	): Promise<FindCursor<WithId<ServerKeyDocument>>> {
		const collection = await this.getCollection();
		return collection.find({
			server_name: serverName,
			...(keyId && { [`verify_keys.${keyId}`]: { $exists: true } }),
			...(validUntil && { valid_until_ts: { $lte: validUntil } }),
		});
	}
}
