import type {
	DataType,
	SignatureType,
	EncryptionValidAlgorithm,
} from '../constants';

// when we only have a public key
export interface VerifierKey {
	// algorithm used, currently only ed25519 is supported
	algorithm: EncryptionValidAlgorithm;
	// key version, can change if rotated for example, can be any arbitrary string
	version: string;

	verify(data: DataType, signature: SignatureType): Promise<void>; // throws if invalid
}

// if we have a private key, we should also have a public key
// this interface is for both signing and verifying payloads
export interface Signer extends VerifierKey {
	sign(data: DataType): Promise<SignatureType>;
}
