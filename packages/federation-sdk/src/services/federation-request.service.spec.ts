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
import * as core from '@rocket.chat/federation-core';
import {
	fromBase64ToBytes,
	loadEd25519SignerFromSeed,
} from '@rocket.chat/federation-crypto';
import { ConfigService } from './config.service';
import { FederationRequestService } from './federation-request.service';

const signingKeyContent =
	'ed25519 a_FAET FC6cwY3DNmHo3B7GRugaHNyXz+TkBRVx8RvQH0kSZ04';

const origin = 'syn1.tunnel.dev.rocket.chat';

const destination = 'syn2.tunnel.dev.rocket.chat';

describe('FederationRequestService', async () => {
	let service: FederationRequestService;
	let configService: ConfigService;

	const mockDiscoveryResult = [
		`https://${destination}:443` as const,
		{
			Host: destination,
		},
	];

	const { getHomeserverFinalAddress } = await import(
		'../server-discovery/discovery'
	);

	const { fetch: originalFetch } = await import('@rocket.chat/federation-core');

	await mock.module('../server-discovery/discovery', () => ({
		getHomeserverFinalAddress: () => mockDiscoveryResult,
	}));

	await mock.module('@rocket.chat/federation-core', () => ({
		fetch: async (_url: string, _options?: RequestInit) => {
			return {
				ok: true,
				status: 200,
				json: async () => ({ result: 'success' }),
				text: async () => '{"result":"success"}',
				multipart: async () => null,
			};
		},
	}));

	afterAll(() => {
		mock.restore();
		mock.module('../server-discovery/discovery', () => ({
			getHomeserverFinalAddress,
		}));
		mock.module('@rocket.chat/federation-core', () => ({
			fetch: originalFetch,
		}));
	});

	beforeEach(() => {
		configService = {
			getConfig: (key: string) => {
				if (key === 'serverName') {
					return origin;
				}
				throw new Error(`Unknown config key: ${key}`);
			},
			serverName: origin,
			getSigningKey: async () => {
				const [, version, signingKey] = signingKeyContent.split(' ');
				return loadEd25519SignerFromSeed(
					fromBase64ToBytes(signingKey),
					version,
				);
			},
		} as unknown as ConfigService;

		service = new FederationRequestService(configService);
	});

	afterEach(() => {
		mock.restore();
	});

	describe('makeSignedRequest', () => {
		it('should make a successful signed request with a body', async () => {
			const transactionBody = {
				edus: [
					{
						content: {
							push: [
								{
									last_active_ago: 561472,
									presence: 'unavailable',
									user_id: '@debdut1:syn1.tunnel.dev.rocket.chat',
								},
							],
						},
						edu_type: 'm.presence',
					},
				],
				origin: 'syn1.tunnel.dev.rocket.chat',
				origin_server_ts: 1757329414731,
				pdus: [],
			};

			// PUT /_matrix/federation/v1/send/1757328278684 HTTP/1.1

			const uri = '/_matrix/federation/v1/send/1757328278684';

			const method = 'PUT';
			const fetchSpy = spyOn(core, 'fetch');

			await service.makeSignedRequest({
				method,
				// Host: syn2.tunnel.dev.rocket.chat
				domain: destination,
				uri,
				body: transactionBody,
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				new URL(`https://${destination}${uri}`),
				expect.objectContaining({
					method: 'PUT',
					headers: expect.objectContaining({
						// Authorization: X-Matrix origin="syn1.tunnel.dev.rocket.chat",key="ed25519:a_FAET",sig="+MRd0eKdc/3T7mS7ZR+ltpOiN7RBXgfxTWWYLejy5gBRXG717aXHPCDm044D10kgqQvs2HqR3MdPEIx+2a0nDg",destination="syn2.tunnel.dev.rocket.chat"
						Authorization:
							'X-Matrix origin="syn1.tunnel.dev.rocket.chat",destination="syn2.tunnel.dev.rocket.chat",key="ed25519:a_FAET",sig="+MRd0eKdc/3T7mS7ZR+ltpOiN7RBXgfxTWWYLejy5gBRXG717aXHPCDm044D10kgqQvs2HqR3MdPEIx+2a0nDg"',
						Host: destination,
					}),
				}),
			);
		});

		it('should make a successful signed GET request', async () => {
			/*
				GET /_matrix/federation/v1/make_join/%21VoUasOLSpcdtRbGHdT%3Asyn2.tunnel.dev.rocket.chat/%40debdut1%3Asyn1.tunnel.dev.rocket.chat?ver=1&ver=2&ver=3&ver=4&ver=5&ver=6&ver=7&ver=8&ver=9&ver=10&ver=11&ver=org.matrix.msc3757.10&ver=org.matrix.msc3757.11 HTTP/1.1
				Host: syn2.tunnel.dev.rocket.chat
				User-Agent: Synapse/1.132.0
				Authorization: X-Matrix origin="syn1.tunnel.dev.rocket.chat",key="ed25519:a_FAET",sig="PNSix5GF9IquSmMOj+yx6rPDEZwcI1KrAQ6TzspAQyrwapQuFYXfhQmxoxKA1X7PUhUGSmQZUWrO4VInIpwwCA",destination="syn2.tunnel.dev.rocket.chat"
			*/
			const uri =
				'/_matrix/federation/v1/make_join/%21VoUasOLSpcdtRbGHdT%3Asyn2.tunnel.dev.rocket.chat/%40debdut1%3Asyn1.tunnel.dev.rocket.chat';
			const method = 'GET';
			const queryString =
				'ver=1&ver=2&ver=3&ver=4&ver=5&ver=6&ver=7&ver=8&ver=9&ver=10&ver=11&ver=org.matrix.msc3757.10&ver=org.matrix.msc3757.11';

			const fetchSpy = spyOn(core, 'fetch');

			await service.makeSignedRequest({
				method,
				domain: destination,
				uri,
				queryString,
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				new URL(`https://${destination}${uri}?${queryString}`),
				expect.objectContaining({
					method: 'GET',
					headers: expect.objectContaining({
						Authorization:
							'X-Matrix origin="syn1.tunnel.dev.rocket.chat",destination="syn2.tunnel.dev.rocket.chat",key="ed25519:a_FAET",sig="PNSix5GF9IquSmMOj+yx6rPDEZwcI1KrAQ6TzspAQyrwapQuFYXfhQmxoxKA1X7PUhUGSmQZUWrO4VInIpwwCA"',
						Host: destination,
					}),
				}),
			);
		});
	});

	describe('requestBinaryData', () => {
		it('should call makeSignedRequest for binary data without query params', async () => {
			const mockBuffer = Buffer.from('binary content');
			const makeSignedRequestSpy = spyOn(
				service,
				'makeSignedRequest',
			).mockResolvedValue({
				ok: true,
				status: 200,
				multipart: async () => ({ content: mockBuffer }),
			} as any);

			const result = await service.requestBinaryData(
				'GET',
				'target.example.com',
				'/media/download',
			);

			expect(makeSignedRequestSpy).toHaveBeenCalledWith({
				method: 'GET',
				domain: 'target.example.com',
				uri: '/media/download',
				queryString: '',
			});
			expect(result).toEqual({ content: mockBuffer });
		});

		it('should call makeSignedRequest for binary data with query params', async () => {
			const mockBuffer = Buffer.from('binary content');
			const makeSignedRequestSpy = spyOn(
				service,
				'makeSignedRequest',
			).mockResolvedValue({
				ok: true,
				status: 200,
				multipart: async () => ({ content: mockBuffer }),
			} as any);

			const result = await service.requestBinaryData(
				'GET',
				'target.example.com',
				'/media/download',
				{ width: '100', height: '100' },
			);

			expect(makeSignedRequestSpy).toHaveBeenCalledWith({
				method: 'GET',
				domain: 'target.example.com',
				uri: '/media/download',
				queryString: 'width=100&height=100',
			});
			expect(result).toEqual({ content: mockBuffer });
		});
	});
});
