/*
 * From a seed to a SigningKey object.
 * The main thing to understand, are,
 * 1. the purpose is to get signature of a payload, generally a string or a Uint8Array - signing happens with the public key
 * 2. verify an existing signature - need the private key for this
 * ^ normal asynchronous cryptographic operations.
 * What changes are how the keys are stored and generated.
 * The easiest tool to use for that is ssh-keygen, for example `ssh-keygen -t ed25519 -C "your_email@example.com"`
 * This will generate a private and a public key pair.
 * An example of a SigningKey object that uses ssh-keygen is in
 */

export enum EncryptionValidAlgorithm {
	ed25519 = 'ed25519',

	rsa = 'rsa', // NOT TO BE USED IN PRODUCTION
}

type Signature = Buffer;

export type GenerateSigningKeyFunc = () => Promise<SigningKey>;

export interface SigningKey {
	// algorithm used, currently only ed25519 is supported
	algorithm: EncryptionValidAlgorithm;
	// key version, can change if rotated for example, can be any arbitrary string
	version: string;

	// main implementors
	sign(data: string | Buffer): Promise<Signature>;
	verify(data: string | Buffer, signature: Signature): Promise<boolean>;
}
