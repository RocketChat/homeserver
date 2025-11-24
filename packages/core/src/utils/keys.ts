import nacl from 'tweetnacl';
import { EncryptionValidAlgorithm } from '../types';
import type { SigningKey } from '../types';
import { signData } from './signJson';

export async function generateKeyPairs(
	seed: Uint8Array,
	algorithm = EncryptionValidAlgorithm.ed25519,
	version = '0',
): Promise<SigningKey> {
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

export const convertSigningKeyToBase64 = (signingKey: SigningKey): string =>
	`${signingKey.algorithm} ${signingKey.version} ${Buffer.from(signingKey.privateKey.slice(0, 32)).toString('base64')}`;
