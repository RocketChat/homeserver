import { createLogger } from '@rocket.chat/federation-core';
import { MongoClient } from 'mongodb';
import type { Db, type MongoClientOptions } from 'mongodb';

export class DatabaseConnectionService {
	private client: MongoClient | null = null;

	private db: Db | null = null;

	private connectionPromise: Promise<void> | null = null;

	private readonly logger = createLogger('DatabaseConnectionService');

	constructor(private readonly config: { uri: string; poolSize: number }) {
		this.connect().catch((err) => this.logger.error({ msg: 'Initial database connection failed', err }));
	}

	async getDb(): Promise<Db> {
		if (!this.db) {
			await this.connect();
		}

		if (!this.db) {
			throw new Error('Database connection not established');
		}

		return this.db;
	}

	private async connect(): Promise<void> {
		if (this.connectionPromise) {
			return this.connectionPromise;
		}

		if (this.client && this.db) {
			return;
		}

		this.connectionPromise = new Promise<void>((resolve, reject) => {
			try {
				const dbConfig = this.config;

				const options: MongoClientOptions = {
					maxPoolSize: dbConfig.poolSize,
				};

				this.client = new MongoClient(dbConfig.uri, options);
				this.client.connect();

				const { dbName } = this.client.options;
				if (!dbName) {
					throw new Error("Can't get database name from MongoDB connection string");
				}

				this.db = this.client.db(dbName);
				this.logger.info(`Connected to MongoDB database: ${dbName}`);

				resolve();
			} catch (error: unknown) {
				this.logger.error({ msg: 'Failed to connect to MongoDB', err: error });
				this.connectionPromise = null;
				reject(new Error('Database connection failed'));
			}
		});

		return this.connectionPromise;
	}

	async disconnect(): Promise<void> {
		if (this.client) {
			await this.client.close();
			this.client = null;
			this.db = null;
			this.connectionPromise = null;
			this.logger.info('Disconnected from MongoDB');
		}
	}
}
