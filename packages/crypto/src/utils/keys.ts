import * as ed25519 from '@noble/ed25519';
import { Ed25519SigningKeyImpl } from '../keys/ed25519';
import type { Signer, VerifierKey } from '../contracts/key';
//
export async function loadEd25519SignerFromSeed(
	seed: Uint8Array,
): Promise<Signer> {
	const { secretKey, publicKey } = await ed25519.keygenAsync(seed);

	return new Ed25519SigningKeyImpl('0', secretKey, publicKey);
}

export async function loadEd25519VerifierFromPublicKey(
	publicKey: Uint8Array,
): Promise<VerifierKey> {
	return new Ed25519SigningKeyImpl('0', new Uint8Array(32), publicKey);
}
