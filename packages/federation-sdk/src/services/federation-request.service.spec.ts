import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from 'bun:test';
import * as core from '@hs/core';
import * as nacl from 'tweetnacl';
import { ConfigService } from './config.service';
import { FederationRequestService } from './federation-request.service';

describe('FederationRequestService', async () => {
	let service: FederationRequestService;
	let configService: ConfigService;

	const mockServerName = 'example.com';
	const mockSigningKey = 'aGVsbG93b3JsZA==';
	const mockSigningKeyId = 'ed25519:1';

	const mockKeyPair = {
		publicKey: new Uint8Array([1, 2, 3]),
		secretKey: new Uint8Array([4, 5, 6]),
	};

	const mockDiscoveryResult = [
		'https://target.example.com:443' as const,
		{
			Host: 'target.example.com',
		},
	];

	const { getHomeserverFinalAddress } = await import(
		'../server-discovery/discovery'
	);

	const { fetch: originalFetch } = await import('@hs/core');

	await mock.module('../server-discovery/discovery', () => ({
		getHomeserverFinalAddress: () => mockDiscoveryResult,
	}));

	await mock.module('@hs/core', () => ({
		fetch: async (_url: string, _options?: RequestInit) => {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: 'success' }),
				text: async () => '{"result":"success"}',
			} as Response;
		},
	}));

	afterAll(() => {
		mock.restore();
		mock.module('../server-discovery/discovery', () => ({
			getHomeserverFinalAddress,
		}));
		mock.module('@hs/core', () => ({
			fetch: originalFetch,
		}));
	});

	const mockSignature = new Uint8Array([7, 8, 9]);

	const mockSignedJson = {
		content: 'test',
		signatures: {
			'example.com': {
				'ed25519:1': 'abcdef',
			},
		},
	};

	const mockAuthHeaders =
		'X-Matrix origin="example.com",destination="target.example.com",key="ed25519:1",sig="xyz123"';

	beforeEach(() => {
		spyOn(nacl.sign.keyPair, 'fromSecretKey').mockReturnValue(mockKeyPair);
		spyOn(nacl.sign, 'detached').mockReturnValue(mockSignature);

		spyOn(core, 'extractURIfromURL').mockReturnValue('/test/path?query=value');
		spyOn(core, 'authorizationHeaders').mockResolvedValue(mockAuthHeaders);
		spyOn(core, 'signJson').mockResolvedValue(mockSignedJson);
		spyOn(core, 'computeAndMergeHash').mockImplementation((obj: any) => obj);

		configService = {
			serverName: mockServerName,
			getSigningKeyBase64: async () => mockSigningKey,
			getSigningKeyId: async () => mockSigningKeyId,
		} as ConfigService;

		service = new FederationRequestService(configService);
	});

	afterEach(() => {
		mock.restore();
	});

	describe('makeSignedRequest', () => {
		it('should make a successful signed request without body', async () => {
			const fetchSpy = spyOn(core, 'fetch');

			const result = await service.makeSignedRequest({
				method: 'GET',
				domain: 'target.example.com',
				uri: '/test/path',
			});

			expect(configService.serverName).toBe(mockServerName);
			expect(await configService.getSigningKeyBase64()).toBe(mockSigningKey);
			expect(await configService.getSigningKeyId()).toBe(mockSigningKeyId);
			expect(configService.serverName).toBe(mockServerName);
			expect(await configService.getSigningKeyBase64()).toBe(mockSigningKey);
			expect(await configService.getSigningKeyId()).toBe(mockSigningKeyId);

			expect(nacl.sign.keyPair.fromSecretKey).toHaveBeenCalled();

			expect(fetchSpy).toHaveBeenCalledWith(
				new URL('https://target.example.com/test/path'),
				expect.objectContaining({
					method: 'GET',
					headers: expect.objectContaining({
						Authorization: mockAuthHeaders,
						Host: 'target.example.com',
					}),
				}),
			);

			expect(result).toEqual({ result: 'success' });
		});

		it('should make a successful signed request with body', async () => {
			const fetchSpy = spyOn(core, 'fetch');

			const mockBody = { key: 'value' };

			const result = await service.makeSignedRequest({
				method: 'POST',
				domain: 'target.example.com',
				uri: '/test/path',
				body: mockBody,
			});

			expect(core.signJson).toHaveBeenCalledWith(
				expect.objectContaining({ key: 'value', signatures: {} }),
				expect.any(Object),
				mockServerName,
			);

			expect(core.authorizationHeaders).toHaveBeenCalledWith(
				mockServerName,
				expect.any(Object),
				'target.example.com',
				'POST',
				'/test/path?query=value',
				mockSignedJson,
			);

			expect(fetchSpy).toHaveBeenCalledWith(
				new URL('https://target.example.com/test/path'),
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify(mockSignedJson),
				}),
			);

			expect(result).toEqual({ result: 'success' });
		});

		it('should make a signed request with query parameters', async () => {
			const fetchSpy = spyOn(core, 'fetch');

			const result = await service.makeSignedRequest({
				method: 'GET',
				domain: 'target.example.com',
				uri: '/test/path',
				queryString: 'param1=value1&param2=value2',
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				new URL(
					'https://target.example.com/test/path?param1=value1&param2=value2',
				),
				expect.any(Object),
			);

			expect(result).toEqual({ result: 'success' });
		});

		it('should handle fetch errors properly', async () => {
			globalThis.fetch = Object.assign(
				async () => {
					return {
						ok: false,
						status: 404,
						text: async () => 'Not Found',
					} as Response;
				},
				{ preconnect: () => {} },
			) as typeof fetch;

			try {
				await service.makeSignedRequest({
					method: 'GET',
					domain: 'target.example.com',
					uri: '/test/path',
				});
			} catch (error: unknown) {
				if (error instanceof Error) {
					expect(error.message).toContain(
						'Federation request failed: 404 Not Found',
					);
				} else {
					throw error;
				}
			}
		});

		it('should handle JSON error responses properly', async () => {
			globalThis.fetch = Object.assign(
				async () => {
					return {
						ok: false,
						status: 400,
						text: async () =>
							'{"error":"Bad Request","code":"M_INVALID_PARAM"}',
					} as Response;
				},
				{ preconnect: () => {} },
			) as typeof fetch;

			try {
				await service.makeSignedRequest({
					method: 'GET',
					domain: 'target.example.com',
					uri: '/test/path',
				});
			} catch (error: unknown) {
				if (error instanceof Error) {
					expect(error.message).toContain(
						'Federation request failed: 400 {"error":"Bad Request","code":"M_INVALID_PARAM"}',
					);
				} else {
					throw error;
				}
			}
		});

		it('should handle network errors properly', async () => {
			globalThis.fetch = Object.assign(
				async () => {
					throw new Error('Network Error');
				},
				{ preconnect: () => {} },
			) as typeof fetch;

			try {
				await service.makeSignedRequest({
					method: 'GET',
					domain: 'target.example.com',
					uri: '/test/path',
				});
			} catch (error: unknown) {
				if (error instanceof Error) {
					expect(error.message).toBe('Network Error');
				} else {
					throw error;
				}
			}
		});
	});

	describe('convenience methods', () => {
		it('should call makeSignedRequest with correct parameters for GET', async () => {
			const makeSignedRequestSpy = spyOn(
				service,
				'makeSignedRequest',
			).mockResolvedValue({ result: 'success' });

			await service.get('target.example.com', '/api/resource', {
				filter: 'active',
			});

			expect(makeSignedRequestSpy).toHaveBeenCalledWith({
				method: 'GET',
				domain: 'target.example.com',
				uri: '/api/resource',
				queryString: 'filter=active',
			});
		});

		it('should call makeSignedRequest with correct parameters for POST', async () => {
			const makeSignedRequestSpy = spyOn(
				service,
				'makeSignedRequest',
			).mockResolvedValue({ result: 'success' });

			const body = { data: 'example' };
			await service.post('target.example.com', '/api/resource', body, {
				version: '1',
			});

			expect(makeSignedRequestSpy).toHaveBeenCalledWith({
				method: 'POST',
				domain: 'target.example.com',
				uri: '/api/resource',
				body,
				queryString: 'version=1',
			});
		});

		it('should call makeSignedRequest with correct parameters for PUT', async () => {
			const makeSignedRequestSpy = spyOn(
				service,
				'makeSignedRequest',
			).mockResolvedValue({ result: 'success' });

			const body = { data: 'updated' };
			await service.put('target.example.com', '/api/resource/123', body);

			expect(makeSignedRequestSpy).toHaveBeenCalledWith({
				method: 'PUT',
				domain: 'target.example.com',
				uri: '/api/resource/123',
				body,
				queryString: '',
			});
		});
	});
});
