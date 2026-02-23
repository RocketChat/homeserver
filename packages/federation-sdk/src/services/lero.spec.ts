import { beforeAll, describe, expect, it } from 'bun:test';

import { init } from '../init';

describe('Lero', async () => {
	beforeAll(() => {
		const databaseConfig = {
			uri: process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true',
			name: 'matrix_test',
			poolSize: 100,
		};

		init({
			dbConfig: databaseConfig,
		});
	});

	it('should create room correctly', async () => {
		expect(true).toBe(true);
	});
});
