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

describe('FederationRequestService – additional edge cases', async () => {
  let service: FederationRequestService;
  let configService: ConfigService;

  const mockServerName = 'example.com';
  const mockSigningKey = 'aGVsbG93b3JsZA==';
  const mockSigningKeyId = 'ed25519:1';

  const mockKeyPair = {
    publicKey: new Uint8Array([1, 2, 3]),
    secretKey: new Uint8Array([4, 5, 6]),
  };

  const discoveryHttps443 = [
    'https://target.example.com:443' as const,
    { Host: 'target.example.com' },
  ];

  const discoveryHttp80 = [
    'http://target.example.com:80' as const,
    { Host: 'target.example.com' },
  ];

  const discoveryCustomPort = [
    'https://target.example.com:8448' as const,
    { Host: 'target.example.com' },
  ];

  const { getHomeserverFinalAddress } = await import('../server-discovery/discovery');
  const { fetch: originalFetch } = await import('@hs/core');

  await mock.module('../server-discovery/discovery', () => ({
    getHomeserverFinalAddress: () => discoveryHttps443,
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

  beforeEach(() => {
    // crypto and core helpers
    spyOn(nacl.sign.keyPair, 'fromSecretKey').mockReturnValue(mockKeyPair);
    spyOn(nacl.sign, 'detached').and.returnValue(new Uint8Array([7, 8, 9]));
    spyOn(core, 'extractURIfromURL').mockReturnValue('/test/path?query=value');
    spyOn(core, 'authorizationHeaders').mockResolvedValue(
      'X-Matrix origin="example.com",destination="target.example.com",key="ed25519:1",sig="xyz123"'
    );
    spyOn(core, 'signJson').mockResolvedValue({
      content: 'test',
      signatures: { 'example.com': { 'ed25519:1': 'abcdef' } },
    });
    spyOn(core, 'computeAndMergeHash').mockImplementation((obj: any) => obj);

    // config
    configService = {
      serverName: mockServerName,
      getSigningKeyBase64: async () => mockSigningKey,
      getSigningKeyId: async () => mockSigningKeyId,
    } as ConfigService;

    // SUT
    service = new FederationRequestService(configService);
  });

  afterEach(() => {
    mock.restore();
  });

  it('builds URL with discovered https:443 and appends provided query string when empty body', async () => {
    const fetchSpy = spyOn(core, 'fetch');
    await service.makeSignedRequest({
      method: 'GET',
      domain: 'target.example.com',
      uri: '/_matrix/federation/v1/version',
      queryString: 'q=1',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      new URL('https://target.example.com/_matrix/federation/v1/version?q=1'),
      expect.any(Object),
    );
  });

  it('respects discovery result with http:80 (no implicit https) when constructing URL', async () => {
    mock.module('../server-discovery/discovery', () => ({
      getHomeserverFinalAddress: () => discoveryHttp80,
    }));

    const fetchSpy = spyOn(core, 'fetch');
    await service.makeSignedRequest({
      method: 'GET',
      domain: 'target.example.com',
      uri: '/health',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      new URL('http://target.example.com/health'),
      expect.any(Object),
    );
  });

  it('respects non-standard port (8448) from discovery when constructing URL', async () => {
    mock.module('../server-discovery/discovery', () => ({
      getHomeserverFinalAddress: () => discoveryCustomPort,
    }));

    const fetchSpy = spyOn(core, 'fetch');
    await service.makeSignedRequest({
      method: 'GET',
      domain: 'target.example.com',
      uri: '/_matrix/key/v2/server',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      new URL('https://target.example.com:8448/_matrix/key/v2/server'),
      expect.any(Object),
    );
  });

  it('omits body for GET even if body is accidentally provided (defensive behavior)', async () => {
    const fetchSpy = spyOn(core, 'fetch');
    await service.makeSignedRequest({
      method: 'GET',
      domain: 'target.example.com',
      uri: '/test/path',
      // accidental body
      body: { shouldNot: 'be sent' } as any,
    });

    const [, opts] = (fetchSpy.mock.calls[0] as any) || [];
    expect(opts.method).toBe('GET');
    expect(opts.body ?? undefined).toBeUndefined();
  });

  it('stringifies body for POST after signing and hashing', async () => {
    const fetchSpy = spyOn(core, 'fetch');
    await service.makeSignedRequest({
      method: 'POST',
      domain: 'target.example.com',
      uri: '/tx',
      body: { hello: 'world' },
    });

    const [, opts] = (fetchSpy.mock.calls[0] as any) || [];
    expect(opts.method).toBe('POST');
    // Body should be the signed JSON not the raw body
    expect(typeof opts.body).toBe('string');
    const parsed = JSON.parse(opts.body);
    expect(parsed.signatures).toBeDefined();
    expect(core.signJson).toHaveBeenCalled();
    expect(core.computeAndMergeHash).toHaveBeenCalled();
  });

  it('propagates authorization headers and Host correctly', async () => {
    const fetchSpy = spyOn(core, 'fetch');
    await service.makeSignedRequest({
      method: 'PUT',
      domain: 'target.example.com',
      uri: '/resource/1',
      body: { a: 1 },
    });

    const [, opts] = (fetchSpy.mock.calls[0] as any) || [];
    expect(opts.headers.Authorization).toContain('X-Matrix');
    expect(opts.headers.Host).toBe('target.example.com');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('throws when required config values are missing (no key id)', async () => {
    configService = {
      serverName: mockServerName,
      getSigningKeyBase64: async () => mockSigningKey,
      getSigningKeyId: async () => undefined as any,
    } as unknown as ConfigService;

    service = new FederationRequestService(configService);

    await expect(
      service.makeSignedRequest({
        method: 'GET',
        domain: 'target.example.com',
        uri: '/test',
      }),
    ).rejects.toThrow();
  });

  it('handles non-JSON error bodies by including raw text in the thrown message', async () => {
    // Simulate failing fetch from @hs/core
    mock.module('@hs/core', () => ({
      fetch: async (_url: string, _options?: RequestInit) => {
        return {
          ok: false,
          status: 502,
          text: async () => 'Bad Gateway',
        } as Response;
      },
    }));

    try {
      await service.makeSignedRequest({
        method: 'GET',
        domain: 'target.example.com',
        uri: '/fail',
      });
      throw new Error('Expected to throw');
    } catch (err) {
      if (err instanceof Error) {
        expect(err.message).toContain('Federation request failed: 502 Bad Gateway');
      } else {
        throw err;
      }
    }
  });

  it('GET/POST/PUT convenience methods join query params deterministically', async () => {
    const spy = spyOn(service as any, 'makeSignedRequest').mockResolvedValue({ ok: 1 });
    await service.get('target.example.com', '/items', { a: '1', b: '2' });
    await service.post('target.example.com', '/items', { x: 1 }, { b: '2', a: '1' });
    await service.put('target.example.com', '/items/1', { y: 2 });

    // Validate parameters passed down
    expect(spy.mock.calls[0][0]).toEqual({
      method: 'GET',
      domain: 'target.example.com',
      uri: '/items',
      queryString: 'a=1&b=2',
    });
    expect(spy.mock.calls[1][0]).toEqual({
      method: 'POST',
      domain: 'target.example.com',
      uri: '/items',
      body: { x: 1 },
      queryString: 'a=1&b=2',
    });
    expect(spy.mock.calls[2][0]).toEqual({
      method: 'PUT',
      domain: 'target.example.com',
      uri: '/items/1',
      body: { y: 2 },
      queryString: '',
    });
  });

  it('bubbles up low-level network error intact (message preserved)', async () => {
    mock.module('@hs/core', () => ({
      fetch: async () => {
        throw new Error('socket hang up');
      },
    }));

    await expect(
      service.makeSignedRequest({
        method: 'GET',
        domain: 'target.example.com',
        uri: '/timeout',
      }),
    ).rejects.toThrow('socket hang up');
  });

  it('normalizes uri joining to avoid double slashes', async () => {
    const fetchSpy = spyOn(core, 'fetch');
    await service.makeSignedRequest({
      method: 'GET',
      domain: 'target.example.com',
      uri: '//double//slashes/', // intentionally odd
    });

    const [url] = (fetchSpy.mock.calls[0] as any) || [];
    expect(String(url)).toMatch(/^https?:\/\/target\.example\.com(:\d+)?\/double\/slashes\/?$/);
  });
});
