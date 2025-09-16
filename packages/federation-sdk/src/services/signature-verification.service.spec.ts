import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	test,
} from 'bun:test';
import {
	VerifierKey,
	fromBase64ToBytes,
	loadEd25519SignerFromSeed,
	loadEd25519VerifierFromPublicKey,
} from '@hs/crypto';
import { PersistentEventFactory } from '@hs/room';
import { SignatureVerificationService } from './signature-verification.service';

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

describe('SignatureVerificationService', async () => {
	let service: SignatureVerificationService;

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

	const verifier = await loadEd25519VerifierFromPublicKey(
		fromBase64ToBytes(mockKeyData.verify_keys[keyId].key),
		'a_FAET',
	);

	const { MAX_SIGNATURE_LENGTH_FOR_ED25519 } = await import(
		'./signature-verification.service'
	);

	beforeEach(() => {
		service = new SignatureVerificationService(); // invalidates internal cache
	});

	afterEach(async () => {
		await mock.module('./signature-verification.service', () => ({
			MAX_SIGNATURE_LENGTH_FOR_ED25519,
		}));
	});

	describe('verifyRequestSignature', async () => {
		const seed = 'FC6cwY3DNmHo3B7GRugaHNyXz+TkBRVx8RvQH0kSZ04';
		const version = 'a_FAET';
		const signer = await loadEd25519SignerFromSeed(
			fromBase64ToBytes(seed),
			version,
		);
		const thisVerifier: VerifierKey = signer;

		it('should successfully validate the request', async () => {
			const header =
				'X-Matrix origin="syn1.tunnel.dev.rocket.chat",destination="syn2.tunnel.dev.rocket.chat",key="ed25519:a_FAET",sig="+MRd0eKdc/3T7mS7ZR+ltpOiN7RBXgfxTWWYLejy5gBRXG717aXHPCDm044D10kgqQvs2HqR3MdPEIx+2a0nDg"';

			const body = {
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

			await expect(
				service.verifyRequestSignature(
					{
						uri,
						method,
						body,
						authorizationHeader: header,
					},
					thisVerifier,
				),
			).resolves.toBeUndefined();
		});
	});

	describe('verifyEventSignature', async () => {
		it('01 should verify a valid event signature', async () => {
			const pdu = PersistentEventFactory.createFromRawEvent(event, '10');

			return expect(
				service.verifyEventSignature(pdu, verifier),
			).resolves.toBeUndefined();
		});

		// each step of the spec
		it('02 should fail if not signed by the origin server (1)', async () => {
			const pdu = PersistentEventFactory.createFromRawEvent(
				{
					...event,
					signatures: {}, // no signatures
				},
				'10',
			);

			return expect(
				service.verifyEventSignature(pdu, verifier),
			).rejects.toThrow(`No signature found for origin ${originServer}`);
		});

		it('03 should fail if signed by algorithm not supported by us (ed25519) (2)', async () => {
			const pdu = PersistentEventFactory.createFromRawEvent(
				{
					...event,
					signatures: {
						[originServer]: {
							// different algorithm
							'not-supported:0': event.signatures[originServer][keyId],
						},
					},
				},
				'10',
			);

			return expect(
				service.verifyEventSignature(pdu, verifier),
			).rejects.toThrow(
				`No valid signature keys found for origin ${originServer} with supported algorithms`,
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

		it('04 should fail if the signature itself is invalid (4.2)', async () => {
			const pdu = PersistentEventFactory.createFromRawEvent(
				{
					...event,
					signatures: {
						[originServer]: {
							[keyId]: '@@@@', // invalid base64
						},
					},
				},
				'10',
			);

			// should fail because the signature length isn't correct for ed25519
			await expect(service.verifyEventSignature(pdu, verifier)).rejects.toThrow(
				/Invalid signature length/,
			);

			await mock.module('./signature-verification.service', () => ({
				MAX_SIGNATURE_LENGTH_FOR_ED25519: 4,
			}));

			await expect(service.verifyEventSignature(pdu, verifier)).rejects.toThrow(
				/Failed to decode base64 signature /,
			);

			const anyString = 'abc123';
			const base64String = btoa(anyString); // valid base64 but not a valid signature

			const pdu2 = PersistentEventFactory.createFromRawEvent(
				{
					...event,
					signatures: {
						[originServer]: {
							[keyId]: base64String,
						},
					},
				},
				'10',
			);

			await mock.module('./signature-verification.service', () => ({
				MAX_SIGNATURE_LENGTH_FOR_ED25519: base64String.length,
			}));

			await expect(
				service.verifyEventSignature(pdu2, verifier),
			).rejects.toThrow('Invalid signature');
		});
	});
});
