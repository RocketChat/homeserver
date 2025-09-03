import type {
	DataType,
	SignatureType,
	EncryptionValidAlgorithm,
} from './constants';

export interface SigningKey {
	// algorithm used, currently only ed25519 is supported
	algorithm: EncryptionValidAlgorithm;
	// key version, can change if rotated for example, can be any arbitrary string
	version: string;

	// main implementors
	sign(data: DataType): Promise<SignatureType>;
	verify(data: DataType, signature: SignatureType): Promise<void>; // throws if invalid
}
