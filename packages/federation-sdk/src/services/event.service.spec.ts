import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	Mock,
	mock,
} from 'bun:test';
import { eventService } from '../__mocks__/services.spec';
import { Pdu, PersistentEventFactory } from '@hs/room';
import { BaseEDU } from '@hs/core';
import { StateService } from './state.service';
import { repositories } from '../__mocks__/repositories.spec';
import { config } from '../__mocks__/config.service.spec';
import { loadEd25519SignerFromSeed } from '../../../crypto/dist/utils/keys';
import { fromBase64ToBytes } from '../../../crypto/dist/utils/data-types';

const event = {
	auth_events: [
		'$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA',
		'$Ulggyo4m1OlI08Z0jJDVeceigjSZP9SdEFVoAn9mEh8',
		'$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg',
		'$kXOAfDVvahrwzHEOInzmG941IeEJTn-qUOY0YnLIigs',
	],
	content: {
		avatar_url: null,
		displayname: 'debdut1',
		membership: 'join' as const,
	},
	depth: 10,
	hashes: { sha256: '6MnKSCFJy1fYf6ukILBEbqx2DkoaD1wRyKXhv689a0A' },
	origin: 'syn1.tunnel.dev.rocket.chat',
	origin_server_ts: 1757328411218,
	prev_events: ['$kXOAfDVvahrwzHEOInzmG941IeEJTn-qUOY0YnLIigs'],
	room_id: '!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat',
	sender: '@debdut1:syn1.tunnel.dev.rocket.chat',
	state_key: '@debdut1:syn1.tunnel.dev.rocket.chat',
	type: 'm.room.member' as const,
	signatures: {
		'syn1.tunnel.dev.rocket.chat': {
			'ed25519:a_FAET':
				'eJlvqxPWPe3u+BM4wOwID9YBlh/ZfVVxGYyA5WgpNs5Fe1+c36qrvCKHuXGGjfQoZFrHmZ3/GJw2pv5EvxCZAA',
		},
	},
	unsigned: {
		age: 1,
		replaces_state: '$kXOAfDVvahrwzHEOInzmG941IeEJTn-qUOY0YnLIigs',
		prev_content: { displayname: 'debdut1', membership: 'invite' },
		prev_sender: '@debdut:syn2.tunnel.dev.rocket.chat',
	},
};

describe('EventService', async () => {
	it('should fail to fetch room informatin of unknown room, sanity check for mock loading', async () => {
		expect(
			eventService.getRoomVersion({ room_id: 'abc123' } as Pdu),
		).rejects.toThrowError(/Create event not found/);
	});

	const { getHomeserverFinalAddress: originalServerDiscovery } = await import(
		'../server-discovery/discovery'
	);

	const { fetch } = await import('@hs/core');

	// random server name for each run
	let inboundServer = `localhost${Math.floor(Math.random() * 10000).toString()}`;

	type FetchJson = Awaited<ReturnType<typeof globalThis.fetch>>['json'];

	const fetchJsonMock: Mock<FetchJson> = mock(() => Promise.resolve());

	beforeEach(async () => {
		await mock.module('../server-discovery/discovery', () => ({
			// this mock doesn't matter, or doesn't change, we just need to skip actual server discovery
			// and mock the /key/v2/server responses
			getHomeserverFinalAddress: async (..._args: any[]) => [
				'https://127.0.0.1',
				{},
			],
		}));

		await mock.module('@hs/core', () => ({
			fetch: async (..._args: any[]) => {
				return {
					ok: true,
					status: 200,
					json: fetchJsonMock as unknown as FetchJson,
				} as Response;
			},
		}));
	});

	afterEach(async () => {
		await mock.module('@hs/core', () => ({ fetch }));
		await mock.module('../server-discovery/discovery', () => ({
			getHomeserverFinalAddress: originalServerDiscovery,
		}));
		mock.restore();
	});

	describe('processIncomingTransaction', async () => {
		it('should fail basic malformed payloads (sanity checks)', async () => {
			expect(
				eventService.processIncomingTransaction({
					origin: 'test.local',
					// @ts-expect-error
					pdus: {},
				}),
			).rejects.toThrowError(/pdus must be an array/);
			expect(
				eventService.processIncomingTransaction({
					origin: 'test.local',
					pdus: [],
					// @ts-expect-error
					edus: {},
				}),
			).rejects.toThrowError(/edus must be an array/);

			expect(
				eventService.processIncomingTransaction({
					origin: 'test.local',
					pdus: Array.from({ length: 51 }).fill({}) as Pdu[],
					edus: [],
				}),
			).rejects.toThrowError(/too-many-events/);

			expect(
				eventService.processIncomingTransaction({
					origin: 'test.local',
					edus: Array.from({ length: 101 }).fill({}) as BaseEDU[],
					pdus: [],
				}),
			).rejects.toThrowError(/too-many-events/);

			// NOTE(deb): should also check the happy path but not running all function tests so skipping that
		});
	});

	describe('_validateHashAndSignatures', async () => {
		const roomVersion = '10' as const;

		// to build events with different signatures, creating new instance of stateService here
		const newSeed = 'JFU4ln6/aSnXWF5EY9m7N9Z/MDUHRLt9C+Z6Vv34Ims';
		const version = 'xxx';
		const signer = await loadEd25519SignerFromSeed(
			fromBase64ToBytes(newSeed),
			version,
		);

		let stateService: StateService;

		beforeEach(async () => {
			inboundServer = `localhost${Math.floor(Math.random() * 10000).toString()}`;
			const newConfig = {
				...config,
				getSigningKey: async () => signer,
				serverName: inboundServer,
			} as unknown as typeof config;

			stateService = new StateService(
				repositories.states,
				repositories.events,
				newConfig,
			);
		});
		// this should be changed as needed
		const originalKeyResponse = {
			old_verify_keys: {},
			server_name: inboundServer,
			signatures: {},
			verify_keys: {
				[signer.id]: {
					key: Buffer.from(signer.getPublicKey()).toString('base64'),
				},
			},
			valid_until_ts: Date.now() + 100000,
		};

		// sanity check
		it('should sign events with new keys', async () => {
			const pdu = PersistentEventFactory.createFromRawEvent(event, roomVersion);

			await stateService.signEvent(pdu);

			expect(pdu.event.signatures[inboundServer]).toBeDefined();
			expect(pdu.event.signatures?.[inboundServer]).toHaveProperty(
				`ed25519:${version}`,
			);

			// now this stateService will pretend to be the other homeserver
		});

		it('should fail if event has an invalid hash', async () => {
			const eventCopy = JSON.parse(JSON.stringify(event));
			eventCopy.content.avatar_url = undefined;

			await expect(
				eventService.validateHashAndSignatures(eventCopy, roomVersion),
			).rejects.toThrowError(/M_INVALID_HASH/);
		});

		it('should successfully validate hash and signature (happy path)', async () => {
			// 1. create an event
			const pdu = PersistentEventFactory.newCreateEvent(
				`@creator:${inboundServer}`,
				roomVersion,
			);

			console.log('PDU', pdu.eventId);

			await stateService.signEvent(pdu);

			// now OUR event service gets this event
			// to allow fetchign the key we mock
			fetchJsonMock.mockReturnValue(Promise.resolve(originalKeyResponse));

			await expect(
				eventService.validateHashAndSignatures(pdu.event, roomVersion),
			).resolves.toHaveProperty('eventId', pdu.eventId);
		});

		it('should fail if signed by a key expired at the point of event creation', async () => {
			const pdu = PersistentEventFactory.newCreateEvent(
				`@creator:${inboundServer}`,
				roomVersion,
			);

			// event created NOW, so will we sign
			await stateService.signEvent(pdu);

			// but the key is expired
			const expiredKeyResponse = {
				...originalKeyResponse,
				valid_until_ts: Date.now() - 10000000,
			};
			fetchJsonMock.mockReturnValue(Promise.resolve(expiredKeyResponse));

			await expect(
				eventService.validateHashAndSignatures(pdu.event, roomVersion),
			).rejects.toThrow();

			// not enough, now we add the key to old_verify_keys
			const oldKeyResponse = {
				...originalKeyResponse,
				verify_keys: {},
				old_verify_keys: {
					[signer.id]: {
						key: Buffer.from(signer.getPublicKey()).toString('base64'),
						expired_ts: Date.now() - 1000,
					},
				},
			};
			fetchJsonMock.mockReturnValue(Promise.resolve(oldKeyResponse));

			// need to invalidate the cache though
			// new room id does it
			const pdu2 = PersistentEventFactory.newCreateEvent(
				`@creator:${inboundServer}`,
				roomVersion,
			);

			// event created NOW, so will we sign
			await stateService.signEvent(pdu2);

			await expect(
				eventService.validateHashAndSignatures(pdu2.event, roomVersion),
			).rejects.toThrow();
		});

		it('should fail if signed by an unknown key', async () => {
			// 1. create an event
			const pdu = PersistentEventFactory.newCreateEvent(
				`@creator:${inboundServer}`,
				roomVersion,
			);

			await stateService.signEvent(pdu);

			// don't send any keys
			fetchJsonMock.mockReturnValue(
				Promise.resolve({ ...originalKeyResponse, verify_keys: {} }),
			);

			await expect(
				eventService.validateHashAndSignatures(pdu.event, roomVersion),
			).rejects.toThrow();
		});

		it('should pass if signed by an old key', async () => {
			const pdu = PersistentEventFactory.newCreateEvent(
				`@creator:${inboundServer}`,
				roomVersion,
			);

			(pdu as any).rawEvent.origin_server_ts -= 2000; // slightly older event

			// event created NOW, so will we sign
			await stateService.signEvent(pdu);

			// key is expired but valid at event time
			const oldKeyResponse = {
				...originalKeyResponse,
				verify_keys: {},
				old_verify_keys: {
					[signer.id]: {
						key: Buffer.from(signer.getPublicKey()).toString('base64'),
						expired_ts: pdu.originServerTs + 1,
					},
				},
			};
			fetchJsonMock.mockReturnValue(Promise.resolve(oldKeyResponse));

			await expect(
				eventService.validateHashAndSignatures(pdu.event, roomVersion),
			).resolves.toHaveProperty('eventId', pdu.eventId);
		});
	});
});
