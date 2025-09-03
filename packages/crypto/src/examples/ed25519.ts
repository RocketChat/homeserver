import {
	DataType,
	EncryptionValidAlgorithm,
	SignatureType,
} from '../constants';
import { SigningKey } from '../signing-key';

import crypto from 'node:crypto';

import * as ed25519 from '@noble/ed25519';
import {
	ed25519PrivateKeyRawToPem,
	ed25519PublicKeyRawToPem,
} from '../ed25519';

// using native crypto module to implement ed25519 signing key
export class Ed25519SigningKeyImpl implements SigningKey {
	public readonly algorithm = EncryptionValidAlgorithm.ed25519;

	constructor(public readonly version: string) {}

	private privateKey?: string;
	private publicKey?: string;

	// generate and store the keys
	async load(seed: Uint8Array) {
		const keypair = await ed25519.keygenAsync(seed);
		this.privateKey = ed25519PrivateKeyRawToPem(keypair.secretKey);
		this.publicKey = ed25519PublicKeyRawToPem(keypair.publicKey);
	}

	async sign(data: DataType): Promise<SignatureType> {
		const dataLike = typeof data === 'string' ? Buffer.from(data) : data;
		return new Promise((resolve, reject) => {
			if (!this.privateKey) {
				reject('Private key not loaded');
				return;
			}

			crypto.sign(
				null,
				dataLike,
				Buffer.from(this.privateKey),
				(error, signature) => {
					if (error) {
						reject(error);
					} else {
						resolve(signature);
					}
				},
			);
		});
	}

	async verify(data: DataType, signature: SignatureType): Promise<void> {
		const dataLike = typeof data === 'string' ? Buffer.from(data) : data;
		return new Promise((resolve, reject) => {
			if (!this.publicKey) {
				throw new Error('Public key not loaded');
			}

			crypto.verify(
				null,
				dataLike,
				Buffer.from(this.publicKey),
				signature,
				(error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				},
			);
		});
	}
}
