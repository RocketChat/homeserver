import * as ed25519 from '@noble/ed25519';

import { encodeCanonicalJson, fromBase64ToBytes, toBinaryData, toUnpaddedBase64 } from './data-types';
import type { Signer, VerifierKey } from '../contracts/key';
import { Ed25519SigningKeyImpl, Ed25519VerifierKeyImpl } from '../keys/ed25519';
//
export async function loadEd25519SignerFromSeed(seed?: Uint8Array, version = '0'): Promise<Signer> {
	const { secretKey, publicKey } = await ed25519.keygenAsync(seed);

	return new Ed25519SigningKeyImpl(version, secretKey, publicKey);
}

export async function loadEd25519VerifierFromPublicKey(publicKey: Uint8Array, version = '0'): Promise<VerifierKey> {
	return new Ed25519VerifierKeyImpl(version, publicKey);
}

export async function signJson<T extends object>(jsonObject: T, key: Signer): Promise<string> {
	const sortedSerializedForm = encodeCanonicalJson(jsonObject);

	const signature = await key.sign(toBinaryData(sortedSerializedForm));

	return toUnpaddedBase64(signature);
}

// throws if invalid
export async function verifyJsonSignature<T extends object>(jsonObject: T, signature: string, key: VerifierKey): Promise<void> {
	const sortedSerializedForm = encodeCanonicalJson(jsonObject);

	const signatureBuffer = fromBase64ToBytes(signature);

	return key.verify(toBinaryData(sortedSerializedForm), signatureBuffer);
}

export function generateEd25519RandomSecretKey(): Buffer<ArrayBuffer> {
	return Buffer.from(ed25519.utils.randomSecretKey());
}
