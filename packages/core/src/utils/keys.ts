import fs from 'node:fs/promises';

import nacl from 'tweetnacl';

import { EncryptionValidAlgorithm } from '../types';
import type { SigningKey } from '../types';
import { toUnpaddedBase64 } from './binaryData';
import { signData } from './signJson';

export async function generateKeyPairs(seed: Uint8Array, algorithm = EncryptionValidAlgorithm.ed25519, version = '0'): Promise<SigningKey> {
	// Generate an Ed25519 key pair
	const keyPair = await nacl.sign.keyPair.fromSeed(seed);

	// Encode the private key to Base64

	return {
		version,
		privateKey: keyPair.secretKey,
		publicKey: keyPair.publicKey,
		algorithm,
		sign(data: Uint8Array) {
			return signData(data, keyPair.secretKey);
		},
	};
}

export async function generateKeyPairsFromString(content: string) {
	const [algorithm, version, seed] = content.trim().split(' ');

	return await generateKeyPairs(
		Uint8Array.from(atob(seed), (c) => c.charCodeAt(0)),
		algorithm as EncryptionValidAlgorithm,
		version,
	);
}

async function storeKeyPairs(
	seeds: {
		algorithm: string;
		version: string;
		seed: Uint8Array;
	}[],
	path: string,
) {
	for await (const keyPair of seeds) {
		await fs.writeFile(path, `${keyPair.algorithm} ${keyPair.version} ${toUnpaddedBase64(keyPair.seed)}`);
	}
}

export const getKeyPair = async (config: { signingKeyPath: string }): Promise<SigningKey[]> => {
	const { signingKeyPath } = config;

	const seeds = [];

	const existingKeyContent = await fs.readFile(signingKeyPath, 'utf8').catch(() => null);

	if (existingKeyContent) {
		const [algorithm, version, seed] = existingKeyContent.trim().split(' ');
		seeds.push({
			algorithm: algorithm as EncryptionValidAlgorithm,
			version,
			seed: Uint8Array.from(atob(seed), (c) => c.charCodeAt(0)),
		});
	} else {
		seeds.push({
			algorithm: 'ed25519' as EncryptionValidAlgorithm,
			version: '0',
			seed: nacl.randomBytes(32),
		});

		await storeKeyPairs(seeds, signingKeyPath);
	}

	return Promise.all(seeds.map(async (seed) => await generateKeyPairs(seed.seed, seed.algorithm, seed.version)));
};

export const convertSigningKeyToBase64 = (signingKey: SigningKey): string =>
	`${signingKey.algorithm} ${signingKey.version} ${Buffer.from(signingKey.privateKey.slice(0, 32)).toString('base64')}`;
