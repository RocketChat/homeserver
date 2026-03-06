import { describe, expect, it } from 'bun:test';
import nacl from 'tweetnacl';
import { EncryptionValidAlgorithm } from '../types';
import { generateKeyPairs, generateKeyPairsFromString } from './keys';

describe('keys', () => {
	describe('generateKeyPairs', () => {
		it('should generate key pairs with default algorithm and version', async () => {
			const seed = nacl.randomBytes(nacl.sign.seedLength);
			const keyPair = await generateKeyPairs(seed);

			expect(keyPair.algorithm).toBe(EncryptionValidAlgorithm.ed25519);
			expect(keyPair.version).toBe('0');
			expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
			expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
		});

		it('should generate key pairs with specified algorithm and version', async () => {
			const seed = nacl.randomBytes(nacl.sign.seedLength);
			const algorithm = EncryptionValidAlgorithm.ed25519;
			const version = '1';
			const keyPair = await generateKeyPairs(seed, algorithm, version);

			expect(keyPair.algorithm).toBe(algorithm);
			expect(keyPair.version).toBe(version);
		});

		it('should sign data correctly', async () => {
			const seed = nacl.randomBytes(nacl.sign.seedLength);
			const keyPair = await generateKeyPairs(seed);
			const data = new TextEncoder().encode('test data');
			const signature = await keyPair.sign(data);

			expect(signature).toBeInstanceOf(Uint8Array);

			const isValid = nacl.sign.detached.verify(
				data,
				signature,
				keyPair.publicKey,
			);

			expect(isValid).toBe(true);
		});
	});

	describe('generateKeyPairsFromString', () => {
		it('should generate key pairs from a valid string', async () => {
			const seed = nacl.randomBytes(nacl.sign.seedLength);
			const seedString = Buffer.from(seed).toString('base64');
			const content = `${EncryptionValidAlgorithm.ed25519} 1 ${seedString}`;
			const keyPair = await generateKeyPairsFromString(content);

			expect(keyPair.algorithm).toBe(EncryptionValidAlgorithm.ed25519);
			expect(keyPair.version).toBe('1');

			const expectedKeyPair = await nacl.sign.keyPair.fromSeed(seed);

			expect(keyPair.publicKey).toEqual(expectedKeyPair.publicKey);
			expect(keyPair.privateKey).toEqual(expectedKeyPair.secretKey);
		});
	});
});
