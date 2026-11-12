import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';

import { type EventID, type Pdu, PersistentEventBase, PersistentEventFactory, type UserID } from '@rocket.chat/federation-room';

import type { EventBase } from '../events/eventBase';
import { EncryptionValidAlgorithm } from '../types';
import type { HashedEvent } from './authentication';
import * as authentication from './authentication';
import { checkSignAndHashes } from './checkSignAndHashes';
import { MatrixError } from './errors';
import { generateKeyPairs } from './keys';
import { signEvent } from './signEvent';
import * as signJson from './signJson';
import type { SignedJson } from './signJson';

describe('checkSignAndHashes', () => {
	const originalAtob = globalThis.atob;

	const mockOrigin = 'example.com';
	const roomVersion = '11';
	const mockSignature = {
		algorithm: EncryptionValidAlgorithm.ed25519,
		version: 'key_version',
		signature: 'bW9ja1NpZ25hdHVyZQ==',
	};
	const mockPublicKey = 'bW9ja1B1YmxpY0tleQ==';
	const mockHash = 'mockHash';

	const mockPdu = {
		type: 'm.room.message',
		content: { body: 'Hello' },
		hashes: {
			sha256: mockHash,
		},
		signatures: {
			[mockOrigin]: {
				'ed25519:key_version': 'someSignature',
			},
		},
	} as unknown as HashedEvent<SignedJson<EventBase>>;

	const getPublicKeyFromServerMock = (_origin: string, _key: string): Promise<string> => {
		return Promise.resolve(mockPublicKey);
	};

	beforeAll(() => {
		globalThis.atob = (str: string): string => {
			if (str === mockSignature.signature) {
				return 'mockSignature';
			}
			if (str === mockPublicKey) {
				return 'mockPublicKey';
			}

			return originalAtob(str);
		};
	});

	afterAll(() => {
		globalThis.atob = originalAtob;
	});

	it('should validate signature and hash successfully', async () => {
		const getSignaturesSpy = spyOn(signJson, 'getSignaturesFromRemote').mockResolvedValue([mockSignature]);
		const verifyJsonSpy = spyOn(signJson, 'verifyJsonSignature').mockReturnValue(true);
		const computeHashSpy = spyOn(authentication, 'computeHash').mockReturnValue(['sha256', mockHash]);

		const result = await checkSignAndHashes(mockPdu, mockOrigin, getPublicKeyFromServerMock, roomVersion);

		expect(getSignaturesSpy).toHaveBeenCalledWith(mockPdu, mockOrigin);
		expect(verifyJsonSpy).toHaveBeenCalled();
		expect(computeHashSpy).toHaveBeenCalledWith(mockPdu);

		expect(result).toEqual(mockPdu);

		getSignaturesSpy.mockRestore();
		verifyJsonSpy.mockRestore();
		computeHashSpy.mockRestore();
	});

	it('should redact according to the room version before verifying', async () => {
		const createPdu = {
			type: 'm.room.create',
			state_key: '',
			room_id: '!room:example.com',
			sender: '@creator:example.com',
			content: { 'room_version': '11', 'm.federate': false },
			hashes: { sha256: mockHash },
			signatures: mockPdu.signatures,
		} as unknown as HashedEvent<SignedJson<EventBase>>;

		const getSignaturesSpy = spyOn(signJson, 'getSignaturesFromRemote').mockResolvedValue([mockSignature]);
		const verifyJsonSpy = spyOn(signJson, 'verifyJsonSignature').mockReturnValue(true);
		const computeHashSpy = spyOn(authentication, 'computeHash').mockReturnValue(['sha256', mockHash]);

		// v11 keeps the whole m.room.create content
		await checkSignAndHashes(createPdu, mockOrigin, getPublicKeyFromServerMock, '11');
		expect(verifyJsonSpy.mock.calls[0][0].content).toEqual({ 'room_version': '11', 'm.federate': false });

		// before v11 only creator survives, so the same event redacts to an empty content
		await checkSignAndHashes(createPdu, mockOrigin, getPublicKeyFromServerMock, '10');
		expect(verifyJsonSpy.mock.calls[1][0].content).toEqual({});

		getSignaturesSpy.mockRestore();
		verifyJsonSpy.mockRestore();
		computeHashSpy.mockRestore();
	});

	it('should throw error for invalid signature', async () => {
		const getSignaturesSpy = spyOn(signJson, 'getSignaturesFromRemote').mockResolvedValue([mockSignature]);
		const verifyJsonSpy = spyOn(signJson, 'verifyJsonSignature').mockReturnValue(false);
		const computeHashSpy = spyOn(authentication, 'computeHash').mockReturnValue(['sha256', mockHash]);

		let error: Error | undefined;
		try {
			await checkSignAndHashes(mockPdu, mockOrigin, getPublicKeyFromServerMock, roomVersion);
		} catch (e) {
			error = e as Error;
		}

		expect(error).toBeInstanceOf(MatrixError);
		expect(error?.message).toBe('Invalid signature');

		getSignaturesSpy.mockRestore();
		verifyJsonSpy.mockRestore();
		computeHashSpy.mockRestore();
	});

	it('should throw error for invalid hash', async () => {
		const getSignaturesSpy = spyOn(signJson, 'getSignaturesFromRemote').mockResolvedValue([mockSignature]);
		const verifyJsonSpy = spyOn(signJson, 'verifyJsonSignature').mockReturnValue(true);
		const computeHashSpy = spyOn(authentication, 'computeHash').mockReturnValue(['sha256', 'differentHash']);

		let error: Error | undefined;
		try {
			await checkSignAndHashes(mockPdu, mockOrigin, getPublicKeyFromServerMock, roomVersion);
		} catch (e) {
			error = e as Error;
		}
		getSignaturesSpy.mockRestore();
		verifyJsonSpy.mockRestore();
		computeHashSpy.mockRestore();

		expect(error).toBeInstanceOf(MatrixError);
		expect(error?.message).toBe('Invalid hash');
	});

	it('should throw error if signature verification fails', async () => {
		const getSignaturesSpy = spyOn(signJson, 'getSignaturesFromRemote');
		getSignaturesSpy.mockImplementation(() => {
			throw new Error('Signature not found');
		});

		let error: Error | undefined;
		try {
			await checkSignAndHashes(mockPdu, mockOrigin, getPublicKeyFromServerMock, roomVersion);
		} catch (e) {
			error = e as Error;
		}

		expect(error).toBeInstanceOf(Error);
		expect(error?.message).toBe('Signature not found');

		getSignaturesSpy.mockRestore();
	});
});

// real keys and no mocks: signs the way StateService.signEvent does and verifies the way an incoming PDU is verified
describe('checkSignAndHashes: room v12', () => {
	const origin = 'example.com';
	const alice = '@alice:example.com' as UserID;

	async function sign(event: PersistentEventBase) {
		const key = await generateKeyPairs(new Uint8Array(32).fill(7));
		const keyId = `${key.algorithm}:${key.version}`;

		const signed = await signEvent(event.redactedEvent as Pdu, key, origin, false);
		event.addSignature(origin, keyId, signed.signatures[origin][keyId]);

		const getPublicKey = async () => Buffer.from(key.publicKey).toString('base64');

		return { pdu: event.event as unknown as HashedEvent<SignedJson<Pdu>>, getPublicKey };
	}

	it('verifies a signed v12 create event, which has no room_id', async () => {
		const create = PersistentEventFactory.newCreateEvent(alice, '12', { additionalCreators: ['@bob:example.com' as UserID] });
		const { pdu, getPublicKey } = await sign(create);

		expect(pdu.room_id).toBeUndefined();
		await expect(checkSignAndHashes(pdu, origin, getPublicKey, '12')).resolves.toEqual(pdu);
	});

	it('verifies a signed v12 message', async () => {
		const create = PersistentEventFactory.newCreateEvent(alice, '12');
		const message = PersistentEventFactory.createFromRawEvent(
			{
				type: 'm.room.message',
				sender: alice,
				room_id: create.roomId,
				content: { msgtype: 'm.text', body: 'hello' },
				origin_server_ts: 2,
				depth: 2,
				prev_events: [create.eventId],
				auth_events: [] as EventID[],
			},
			'12',
		);
		const { pdu, getPublicKey } = await sign(message);

		await expect(checkSignAndHashes(pdu, origin, getPublicKey, '12')).resolves.toEqual(pdu);
	});

	it('rejects a v12 create event whose additional_creators were tampered with', async () => {
		const create = PersistentEventFactory.newCreateEvent(alice, '12', { additionalCreators: ['@bob:example.com' as UserID] });
		const { pdu, getPublicKey } = await sign(create);

		const tampered = { ...pdu, content: { ...pdu.content, additional_creators: ['@eve:example.com'] } } as typeof pdu;

		await expect(checkSignAndHashes(tampered, origin, getPublicKey, '12')).rejects.toThrow('Invalid signature');
	});
});
