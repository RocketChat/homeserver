import { verifyJsonSignature } from '@hs/crypto';

import { Mock, describe, expect, it, mock } from 'bun:test';
import { afterEach, beforeEach } from 'node:test';

import { config } from '../__mocks__/config.service.spec';
import { keyService } from '../__mocks__/services.spec';
import { signer } from '../__mocks__/singer.spec';

describe('KeyService', async () => {
	// fetch mocking
	const { fetch } = await import('@hs/core');

	let inboundServer = ''; // skips server discovery

	beforeEach(async () => {
		await mock.module('@hs/core', () => ({
			fetch: async (..._args: any[]) => {
				return {
					ok: true,
					status: 200,
					json: fetchJsonMock as unknown as FetchJson,
				} as Response;
			},
		}));
		inboundServer = `localhost:${Math.floor(Math.random() * 10000)}`;
	});

	afterEach(async () => {
		await mock.module('@hs/core', () => ({ fetch }));
		mock.restore();
	});

	type FetchJson = Awaited<ReturnType<typeof globalThis.fetch>>['json'];

	const fetchJsonMock: Mock<FetchJson> = mock(() => Promise.resolve());
	const publicKey = Buffer.from(signer.getPublicKey()).toString('base64');

	it('should act as a notary server', async () => {
		fetchJsonMock.mockReturnValue(
			Promise.resolve({
				server_name: inboundServer,
				valid_until_ts: Date.now() + 100000,
				verify_keys: {
					'ed25519:0': { key: publicKey },
				},
				signatures: {
					[inboundServer]: {
						'ed25519:0': 'c2lnbmF0dXJl', // dummy signature, not verified in this test
					},
				},
				old_verify_keys: {},
			}),
		);

		const response = await keyService.handleQuery({
			server_keys: { [inboundServer]: {} },
		});

		expect(response).toHaveProperty('server_keys');
		expect(response.server_keys).toBeArray();

		const key = response.server_keys.find(
			(k: unknown) =>
				typeof k === 'object' &&
				k !== null &&
				'server_name' in k &&
				k.server_name === inboundServer &&
				'verify_keys' in k &&
				typeof k.verify_keys === 'object' &&
				k.verify_keys !== null &&
				'ed25519:0' in k.verify_keys &&
				k.verify_keys['ed25519:0'],
		);

		expect(key).toBeDefined();

		expect(key).toHaveProperty('verify_keys');
		expect(key.verify_keys).toHaveProperty('ed25519:0');
		expect(key.verify_keys['ed25519:0']).toHaveProperty('key');
		expect(key.verify_keys['ed25519:0'].key).toBeString();
		expect(key.verify_keys['ed25519:0'].key).toBe(publicKey);

		const signature = key?.signatures?.[config.serverName];

		expect(signature).toBeDefined();
		expect(Object.keys(signature).length).toBeGreaterThanOrEqual(1);

		const signatureValue = signature?.['ed25519:0'];

		expect(signatureValue).toBeDefined();

		const { signatures, ...rest } = key;

		expect(
			verifyJsonSignature(rest, signatureValue, signer),
		).resolves.toBeUndefined();
	});

	it('should return an expired key if it can not find any others', async () => {
		const keyId0 = 'ed25519:0';
		// -24 hours
		const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

		const keyResponse0 = {
			server_name: inboundServer,
			valid_until_ts: expiresAt.getTime(),
			verify_keys: {
				[keyId0]: { key: publicKey },
			},
			old_verify_keys: {},
			signatures: {},
		};

		fetchJsonMock.mockReturnValue(Promise.resolve(keyResponse0));

		// fills the database with an expired key
		await keyService.handleQuery({
			server_keys: { [inboundServer]: { [keyId0]: {} } },
		});

		// make a second request
		await keyService.handleQuery({
			server_keys: {
				[inboundServer]: {
					[keyId0]: {
						minimum_valid_until_ts: expiresAt.getTime() + 1000,
					},
				},
			},
		});

		const { server_keys: serverKeys } = await keyService.handleQuery({
			server_keys: {
				[inboundServer]: {
					[keyId0]: {
						minimum_valid_until_ts: expiresAt.getTime() + 1000,
					},
				},
			},
		});

		expect(serverKeys).toBeArray();
		expect(serverKeys[0]).toHaveProperty('server_name', inboundServer);
		expect(serverKeys[0].verify_keys).toHaveProperty(keyId0);
		expect(serverKeys[0].valid_until_ts).toBe(expiresAt.getTime());
	});

	it('must not overwrite a valid key with a spurious result from the origin server', async () => {
		const keyid1 = 'ed25519:1';
		// -24 houts
		const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

		const keyResponse1 = {
			server_name: inboundServer,
			valid_until_ts: expiresAt.getTime(),
			verify_keys: {
				[keyid1]: { key: publicKey },
			},
			old_verify_keys: {},
			signatures: {},
		};

		fetchJsonMock.mockReturnValue(Promise.resolve(keyResponse1));

		const response1 = await keyService.handleQuery({
			server_keys: { [inboundServer]: { [keyid1]: {} } },
		});

		expect(response1.server_keys[0]).toHaveProperty(
			'server_name',
			inboundServer,
		);
		expect(response1.server_keys[0].verify_keys).toHaveProperty(keyid1);

		const keyid2 = 'ed25519:2';
		fetchJsonMock.mockReturnValue(
			Promise.resolve({
				server_name: inboundServer,
				valid_until_ts: expiresAt.getTime() + 1000,
				verify_keys: {
					[keyid2]: { key: publicKey },
				},
				old_verify_keys: {},
				signatures: {},
			}),
		);

		await keyService.handleQuery({
			server_keys: {
				[inboundServer]: {
					[keyid1]: {
						minimum_valid_until_ts: Date.now(),
					},
				},
			},
		});

		const finalResponse = await keyService.handleQuery({
			server_keys: {
				[inboundServer]: {
					[keyid1]: {
						minimum_valid_until_ts: expiresAt.getTime(),
					},
				},
			},
		});

		expect(finalResponse.server_keys[0]).toHaveProperty(
			'server_name',
			inboundServer,
		);
		expect(finalResponse.server_keys[0].verify_keys).toHaveProperty(keyid1);
	});
});
