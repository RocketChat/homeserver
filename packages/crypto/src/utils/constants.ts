export enum EncryptionValidAlgorithm {
	ed25519 = 'ed25519',
}

export type DataType = string | Buffer | Uint8Array;

export type SignatureType = Buffer | Uint8Array;

export function isValidAlgorithm(alg: string): alg is EncryptionValidAlgorithm {
	for (const validAlg of Object.values(EncryptionValidAlgorithm)) {
		if (alg === validAlg) {
			return true;
		}
	}

	return false;
}
