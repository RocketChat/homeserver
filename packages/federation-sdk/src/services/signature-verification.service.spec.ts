import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	test,
	type Mock,
} from 'bun:test';
import { SignatureVerificationService } from './signature-verification.service';
import { PersistentEventFactory } from '@hs/room';

const originServer = 'syn1.tunnel.dev.rocket.chat';

const keyId = 'ed25519:a_FAET';

// v10
const event = {
	auth_events: [
		'$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA',
		'$Ulggyo4m1OlI08Z0jJDVeceigjSZP9SdEFVoAn9mEh8',
		'$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg',
		'$kXOAfDVvahrwzHEOInzmG941IeEJTn-qUOY0YnLIigs',
	],
	content: {
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

describe('SignatureVerificationService', () => {
	let service: SignatureVerificationService;

	let originalFetch: typeof globalThis.fetch;

	const mockKeyData = {
		old_verify_keys: {},
		server_name: 'syn1.tunnel.dev.rocket.chat',
		signatures: {
			'syn1.tunnel.dev.rocket.chat': {
				'ed25519:a_FAET':
					'32jfhYKQGENYAByGWZlMPcqgLcGJCoU9RyxOz4TGrmGbTwmbBi8BGbgNJHH8DmWuyoD6FnZ4yI5YBZTJqPjQAA',
			},
		},
		valid_until_ts: 1757414678669,
		verify_keys: {
			'ed25519:a_FAET': { key: 'kryovKVnhHESOdWuZ05ViNotRMVdEh/mG2yJ0npLzEo' },
		},
	};

	type FetchJson = Awaited<ReturnType<typeof globalThis.fetch>>['json'];

	const fetchJsonMock: Mock<FetchJson> = mock(() =>
		Promise.resolve(mockKeyData),
	);

	beforeEach(() => {
		originalFetch = globalThis.fetch;

		service = new SignatureVerificationService(); // invalidates internal cache

		fetchJsonMock.mockReturnValue(Promise.resolve(mockKeyData));

		globalThis.fetch = Object.assign(
			async (_url: string, _options?: RequestInit) => {
				return {
					ok: true,
					status: 200,
					json: fetchJsonMock as unknown as FetchJson,
				} as Response;
			},
			{ preconnect: () => {} },
		) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		mock.restore();
	});

	describe('verifyEventSignature', async () => {
		it('should verify a valid event signature', async () => {
			const pdu = PersistentEventFactory.createFromRawEvent(
				structuredClone(event),
				'10',
			);

			return expect(service.verifyEventSignature(pdu)).resolves.toBeUndefined();
		});

		// each step of the spec
		it('should fail if not signed by the origin server (1)', async () => {
			const eventClone = structuredClone(event);

			const pdu = PersistentEventFactory.createFromRawEvent({
				...eventClone,
				signatures: {}, // no signatures
			});

			return expect(service.verifyEventSignature(pdu)).rejects.toThrow(
				`No signature found for origin ${originServer}`,
			);
		});

		it('should fail if signed by algorithm not supported by us (ed25519) (2)', async () => {
			const eventClone = structuredClone(event);

			const pdu = PersistentEventFactory.createFromRawEvent({
				...eventClone,
				signatures: {
					[originServer]: {
						// different algorithm
						'not-supported:0': event.signatures[originServer][keyId],
					},
				},
			});

			return expect(service.verifyEventSignature(pdu)).rejects.toThrow(
				`No valid signature keys found for origin ${originServer} with supported algorithms`,
			);
		});

		it('should fail if service could not find the public key from the origin homeserver (3.1)', async () => {
			const eventClone = structuredClone(event);

			const pdu = PersistentEventFactory.createFromRawEvent(eventClone);

			// making fetch fail
			fetchJsonMock.mockReturnValue(Promise.reject(new Error('network error')));

			return expect(service.verifyEventSignature(pdu)).rejects.toThrow(
				`No valid verification key found for origin ${originServer} with supported algorithms`,
			);
		});

		test.todo(
			'should pass if service find any of the supported keys from the origin homeserver (3.2)',
			async () => {
				// need event to be signed by multiple keys
			},
		);

		test.todo(
			'should fail if the signature itself is invalid base64 (4.1)',
			async () => {
				// need event to be signed by multiple keys
			},
		);

		it('should fail if the signature itself is invalid (4.2)', async () => {
			const eventClone = structuredClone(event);

			const pdu = PersistentEventFactory.createFromRawEvent({
				...eventClone,
				signatures: {
					[originServer]: {
						[keyId]: '@@@@', // invalid base64
					},
				},
			});

			// should fail because the signature length isn't correct for ed25519
			await expect(service.verifyEventSignature(pdu)).rejects.toThrow(
				/Invalid signature length/,
			);

			await mock.module('./signature-verification.service', () => ({
				MAX_SIGNATURE_LENGTH_FOR_ED25519: 4,
			}));

			await expect(service.verifyEventSignature(pdu)).rejects.toThrow(
				/Failed to decode base64 signature /,
			);

			const anyString = 'abc123';
			const base64String = btoa(anyString); // valid base64 but not a valid signature

			const pdu2 = PersistentEventFactory.createFromRawEvent({
				...eventClone,
				signatures: {
					[originServer]: {
						[keyId]: base64String,
					},
				},
			});

			await mock.module('./signature-verification.service', () => ({
				MAX_SIGNATURE_LENGTH_FOR_ED25519: base64String.length,
			}));

			await expect(service.verifyEventSignature(pdu2)).rejects.toThrow(
				'Invalid signature',
			);
		});
	});
});
