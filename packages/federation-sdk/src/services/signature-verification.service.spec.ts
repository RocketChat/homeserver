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

/*
 * {"type":"m.room.create","state_key":"","content":{"room_version":"10","creator":"@debdut:rc1.tunnel.dev.rocket.chat"},"sender":"@debdut:rc1.tunnel.dev.rocket.chat","origin_server_ts":1753363422133,"origin":"rc1.tunnel.dev.rocket.chat","room_id":"!uUGiqDlq:rc1.tunnel.dev.rocket.chat","prev_events":[],"auth_events":[],"depth":0,"hashes":{"sha256":"n4Vml4VWf+qXqS0AtFD8WK3JYGQWQO4sNB8CXV3HarM"},"signatures":{"rc1.tunnel.dev.rocket.chat":{"ed25519:0":"m9ccld2sylkt4E5kn36BPyLiWL/wJFYE2vzkp62FGmxO2DQ66a+qMz5lq18+rkEjNxONREfTioJov3s6nHjhAA"}},"unsigned":{}}
 * {"old_verify_keys":{},"server_name":"rc1.tunnel.dev.rocket.chat","signatures":{"rc1.tunnel.dev.rocket.chat":{"ed25519:0":"kNs1Wqt3MDNVZg1gQ+c0mXiiOmpCnR41siXdHes8wNvq0SQb5VCSa1Fz+LF6WN10fNyBoBp6ukc19bKQKreNCw"}},"valid_until_ts":1754130035648,"verify_keys":{"ed25519:0":{"key":"RL+t3F91NXGsUI9YZtKBRMETgUgfApqfeA3q8Go/Uo4"}}}
 */

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

/*
 * {"event":{"auth_events":["$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA","$Ulggyo4m1OlI08Z0jJDVeceigjSZP9SdEFVoAn9mEh8","$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg","$kXOAfDVvahrwzHEOInzmG941IeEJTn-qUOY0YnLIigs"],"content":{"avatar_url":null,"displayname":"debdut1","membership":"join"},"depth":10,"hashes":{"sha256":"6MnKSCFJy1fYf6ukILBEbqx2DkoaD1wRyKXhv689a0A"},"origin":"syn1.tunnel.dev.rocket.chat","origin_server_ts":1757328411218,"prev_events":["$kXOAfDVvahrwzHEOInzmG941IeEJTn-qUOY0YnLIigs"],"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","sender":"@debdut1:syn1.tunnel.dev.rocket.chat","state_key":"@debdut1:syn1.tunnel.dev.rocket.chat","type":"m.room.member","signatures":{"syn1.tunnel.dev.rocket.chat":{"ed25519:a_FAET":"eJlvqxPWPe3u+BM4wOwID9YBlh/ZfVVxGYyA5WgpNs5Fe1+c36qrvCKHuXGGjfQoZFrHmZ3/GJw2pv5EvxCZAA"}},"unsigned":{"age":1,"replaces_state":"$kXOAfDVvahrwzHEOInzmG941IeEJTn-qUOY0YnLIigs","prev_content":{"displayname":"debdut1","membership":"invite"},"prev_sender":"@debdut:syn2.tunnel.dev.rocket.chat"}},"state":[{"auth_events":["$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA","$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg","$ZDZHSsYiyL4LlRhIIUKVZnlDcVmn8NonWySS0DbvzFQ"],"prev_events":["$sOuxoPjLRgDVgtgKrmBxdVFRc9hfODoXHvwfznrBJvk"],"type":"m.room.guest_access","sender":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"guest_access":"can_join"},"depth":6,"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","state_key":"","origin_server_ts":1757328362604,"hashes":{"sha256":"TrP386yOPRnjhRF0wIrR+558ZPbmv3dVP66rMOrqapA"},"signatures":{"syn2.tunnel.dev.rocket.chat":{"ed25519:a_ZsSJ":"kDuj6bQcTT7TBAkSFFjw/qwTg7afo2VFyRDma1O3HVFt00wUkgmB2yHqOehmD64uwsirCdYgy6v+geeR2z3xBw"}},"unsigned":{"age":49854}},{"auth_events":["$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA","$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg","$ZDZHSsYiyL4LlRhIIUKVZnlDcVmn8NonWySS0DbvzFQ"],"prev_events":["$_wPeMHrY4MrlDX21jtu0z6jFBz37G8akqmZDhORIqco"],"type":"m.room.name","sender":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"name":"aaaaaaaa"},"depth":8,"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","state_key":"","origin_server_ts":1757328362604,"hashes":{"sha256":"RnymDqNP7NRKoaqEtVGBW2DV3tevZ/jCZY7AcdbZynM"},"signatures":{"syn2.tunnel.dev.rocket.chat":{"ed25519:a_ZsSJ":"+D1Ir0W1UY5nd+rIQlHgAedmTciPW6CFPp4bbARYhiB5upIERuE46zSUqpkjIPYKV2tC5SI4EVONQwtEmPRBBQ"}},"unsigned":{"age":49854}},{"auth_events":["$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA","$Ulggyo4m1OlI08Z0jJDVeceigjSZP9SdEFVoAn9mEh8","$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg","$ZDZHSsYiyL4LlRhIIUKVZnlDcVmn8NonWySS0DbvzFQ"],"prev_events":["$jjtu7bXR1KQ5pyHjtu71l4Y0HsDRxfpyA7XZ3Y7K7Hg"],"type":"m.room.member","sender":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"displayname":"debdut1","membership":"invite"},"depth":9,"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","state_key":"@debdut1:syn1.tunnel.dev.rocket.chat","origin_server_ts":1757328402120,"hashes":{"sha256":"o5Ph/P2Lybk2fU1NUSsAYQi36SOLdvClaBWBTa5KUL8"},"signatures":{"syn2.tunnel.dev.rocket.chat":{"ed25519:a_ZsSJ":"Uj9SNp+B95gi29U+BnIaQA60B/kY8ZnbMfaUGog4SU7OEPLhTNh7SOcki1TBkdl6OlRCkGypKVJXyx7b/J7MAA"},"syn1.tunnel.dev.rocket.chat":{"ed25519:a_FAET":"plQW1ZLVhu6EIGCa2hHBv4GWyjOzXBSQ+hMyj+DlX0BHMD3+3GsmJbiYySmh2kmMEP3IsI4YS0D9MquN6VHsDg"}},"unsigned":{"invite_room_state":[{"type":"m.room.join_rules","state_key":"","content":{"join_rule":"invite"},"sender":"@debdut:syn2.tunnel.dev.rocket.chat"},{"type":"m.room.create","state_key":"","content":{"room_version":"10","creator":"@debdut:syn2.tunnel.dev.rocket.chat"},"sender":"@debdut:syn2.tunnel.dev.rocket.chat"},{"type":"m.room.encryption","state_key":"","content":{"algorithm":"m.megolm.v1.aes-sha2"},"sender":"@debdut:syn2.tunnel.dev.rocket.chat"},{"type":"m.room.name","state_key":"","content":{"name":"aaaaaaaa"},"sender":"@debdut:syn2.tunnel.dev.rocket.chat"},{"type":"m.room.member","state_key":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"displayname":"debdut","membership":"join"},"sender":"@debdut:syn2.tunnel.dev.rocket.chat"}],"age":10338}},{"auth_events":["$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA","$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg","$ZDZHSsYiyL4LlRhIIUKVZnlDcVmn8NonWySS0DbvzFQ"],"prev_events":["$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA"],"type":"m.room.join_rules","sender":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"join_rule":"invite"},"depth":4,"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","state_key":"","origin_server_ts":1757328362603,"hashes":{"sha256":"ak/Qv/mMfgvK/XdJGoc9Poby2BUtriHMgRGZcbYspMU"},"signatures":{"syn2.tunnel.dev.rocket.chat":{"ed25519:a_ZsSJ":"hYm15xFhJQfG90noqFPKnV7ZLIqENBM5ICMAZZS8GQnXvWOGdGEOkeKj4uXIEEsxxxad/Sc1xce5vV+raTuQCA"}},"unsigned":{"age":49855}},{"auth_events":["$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg","$ZDZHSsYiyL4LlRhIIUKVZnlDcVmn8NonWySS0DbvzFQ"],"prev_events":["$ZDZHSsYiyL4LlRhIIUKVZnlDcVmn8NonWySS0DbvzFQ"],"type":"m.room.power_levels","sender":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"users":{"@debdut:syn2.tunnel.dev.rocket.chat":100},"users_default":0,"events":{"m.room.name":50,"m.room.avatar":50,"m.room.power_levels":100,"m.room.history_visibility":100,"m.room.canonical_alias":50,"m.room.tombstone":100,"m.room.server_acl":100,"m.room.encryption":100,"org.matrix.msc3401.call.member":0,"org.matrix.msc3401.call":100},"events_default":0,"state_default":50,"ban":50,"kick":50,"redact":50,"invite":0,"historical":100},"depth":3,"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","state_key":"","origin_server_ts":1757328362598,"hashes":{"sha256":"N8XBL3oJrwU/5SP4Uqa+jbIEqsts+cgFs04bnB0zMFM"},"signatures":{"syn2.tunnel.dev.rocket.chat":{"ed25519:a_ZsSJ":"zJ3u25+gz99P+WmRBYgNOtqqIBb1jngMALLxqljlrIG/ifDLy1UyXtwm/g5a6r9qTLE/taql99DCPY4kXH3nAA"}},"unsigned":{"age":49860}},{"auth_events":[],"prev_events":[],"type":"m.room.create","sender":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"room_version":"10","creator":"@debdut:syn2.tunnel.dev.rocket.chat"},"depth":1,"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","state_key":"","origin_server_ts":1757328362536,"hashes":{"sha256":"Wqul5TbaOj83JuQkKj/CTlYeaUtocHePDFIVqBzJJS4"},"signatures":{"syn2.tunnel.dev.rocket.chat":{"ed25519:a_ZsSJ":"4uOTMonGEXg74DOOcWgkpRMzmkPg/cQVp9b16jYPPFOgMk8Tr5lOWDa/jAUlVEALj2kYHRblk3UacMaQzvPaDw"}},"unsigned":{"age":49922}},{"auth_events":["$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA","$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg","$ZDZHSsYiyL4LlRhIIUKVZnlDcVmn8NonWySS0DbvzFQ"],"prev_events":["$Ulggyo4m1OlI08Z0jJDVeceigjSZP9SdEFVoAn9mEh8"],"type":"m.room.history_visibility","sender":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"history_visibility":"shared"},"depth":5,"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","state_key":"","origin_server_ts":1757328362604,"hashes":{"sha256":"+UW9TzftG+Q5aM46uLOiOiMlOSDdvMVDMSf/EZonvR4"},"signatures":{"syn2.tunnel.dev.rocket.chat":{"ed25519:a_ZsSJ":"oNyD4B2gfy8+e6r+ZDSAb807gEhx40d6exLrVWmsn4s+N6qZ28i41DWfttpZap+GPwVDA4mpCZWkZet0rBBxDw"}},"unsigned":{"age":49854}},{"auth_events":["$Hvb-xPPDhTvlXZe2kMubgj8J7iUa5W7YvjTqMTffgUA","$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg","$ZDZHSsYiyL4LlRhIIUKVZnlDcVmn8NonWySS0DbvzFQ"],"prev_events":["$-1FmjaDcaLllAM91flimqEJ9xqCw5zBv3kdMUcr7Etk"],"type":"m.room.encryption","sender":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"algorithm":"m.megolm.v1.aes-sha2"},"depth":7,"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","state_key":"","origin_server_ts":1757328362604,"hashes":{"sha256":"L0FLRolYQPHm4AuxTLHzysz6Nmh8tmWuERKYUHO5yeM"},"signatures":{"syn2.tunnel.dev.rocket.chat":{"ed25519:a_ZsSJ":"qJyKdg+J1ER4Et1hrqiQNc3mM3VCM8Q6DNnlSu/9lypRW5VRZy3HvPKukvgoyQr1/ewc+0x0EoeT0ca5wrxCDA"}},"unsigned":{"age":49854}}],"auth_chain":[{"auth_events":["$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg"],"prev_events":["$G2TzsvetG2YlHr20tZLHCCzOd-yxPa1jeFT8OU4_6kg"],"type":"m.room.member","sender":"@debdut:syn2.tunnel.dev.rocket.chat","content":{"displayname":"debdut","membership":"join"},"depth":2,"room_id":"!VoUasOLSpcdtRbGHdT:syn2.tunnel.dev.rocket.chat","state_key":"@debdut:syn2.tunnel.dev.rocket.chat","origin_server_ts":1757328362573,"hashes":{"sha256":"OQ9F8BCBAjylOXjPPt6ZZGfaVUe0aInmPLoaAS9PY8E"},"signatures":{"syn2.tunnel.dev.rocket.chat":{"ed25519:a_ZsSJ":"wPLUukVrilo2byP4sptw2gJCXPPSuLrv4pQtSPvazx9aw0Fs/tZNVANaum1lt4adigGn5Zzlj6gnA4k65z3hAQ"}},"unsigned":{"age":49885}}],"members_omitted":true,"servers_in_room":["syn2.tunnel.dev.rocket.chat"]}
 *
 * {"old_verify_keys":{},"server_name":"syn1.tunnel.dev.rocket.chat","signatures":{"syn1.tunnel.dev.rocket.chat":{"ed25519:a_FAET":"32jfhYKQGENYAByGWZlMPcqgLcGJCoU9RyxOz4TGrmGbTwmbBi8BGbgNJHH8DmWuyoD6FnZ4yI5YBZTJqPjQAA"}},"valid_until_ts":1757414678669,"verify_keys":{"ed25519:a_FAET":{"key":"kryovKVnhHESOdWuZ05ViNotRMVdEh/mG2yJ0npLzEo"}}}
 */

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
