import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';

import type { EventBase } from '../events/eventBase';
import { EncryptionValidAlgorithm } from '../types';
import type { HashedEvent } from './authentication';
import * as authentication from './authentication';
import { checkSignAndHashes } from './checkSignAndHashes';
import { MatrixError } from './errors';
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
		expect(verifyJsonSpy.mock.calls[0][0]).toMatchObject({
			content: { 'room_version': '11', 'm.federate': false },
		});

		// before v11 only creator survives, so the same event redacts to an empty content
		await checkSignAndHashes(createPdu, mockOrigin, getPublicKeyFromServerMock, '10');
		expect(verifyJsonSpy.mock.calls[1][0]).toMatchObject({ content: {} });

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
