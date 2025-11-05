import { ConfigService } from '../services/config.service';
import { DatabaseConnectionService } from '../services/database-connection.service';
import { signer } from './singer.spec';

const databaseConfig = {
	uri: 'mongodb://localhost:27017/matrix_test',
	name: 'matrix_test',
	poolSize: 100,
};

export const config = {
	serverName: 'test.local',
	getSigningKey: async () => signer,
	database: databaseConfig,
	getDatabaseConfig: function () {
		// @ts-ignore
		return this.database;
	},
} as unknown as ConfigService;

const database = new DatabaseConnectionService(databaseConfig);

export const db = await database.getDb();
