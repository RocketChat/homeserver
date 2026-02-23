import crypto from 'node:crypto';

import type { Signer, VerifierKey } from '../contracts/key';
import { ed25519PrivateKeyRawToPem, ed25519PublicKeyRawToPem } from '../rfc/8410/ed25519-pem';
import { EncryptionValidAlgorithm } from '../utils/constants';

export class Ed25519VerifierKeyImpl implements VerifierKey {
	algorithm = EncryptionValidAlgorithm.ed25519;

	private _publicKeyPem: string;

	public get id() {
		return `${this.algorithm}:${this.version}` as const;
	}

	public getPublicKey(): Uint8Array {
		return this.publicKey;
	}

	public getPublicKeyPem(): string {
		return this._publicKeyPem;
	}

	constructor(public version: string, public readonly publicKey: Uint8Array) {
		this._publicKeyPem = ed25519PublicKeyRawToPem(this.publicKey);
	}

	public async verify(data: Uint8Array, signature: Uint8Array): Promise<void> {
		return new Promise((resolve, reject) => {
			crypto.verify(null, data, this._publicKeyPem, signature, (err, verified) => {
				if (err) {
					reject(err);
				} else if (verified) {
					resolve();
				} else {
					reject(new Error('Invalid signature'));
				}
			});
		});
	}
}

export class Ed25519SigningKeyImpl extends Ed25519VerifierKeyImpl implements Signer {
	public async sign(data: Uint8Array) {
		return new Promise<Uint8Array>((resolve, reject) => {
			crypto.sign(null, data, this._privateKeyPem, (err, signature) => {
				if (err) {
					return reject(err);
				}
				return resolve(signature);
			});
		});
	}

	private _privateKeyPem!: string;

	constructor(public version: string, public readonly privateKey: Uint8Array, publicKey: Uint8Array) {
		super(version, publicKey);
		this._privateKeyPem = ed25519PrivateKeyRawToPem(privateKey);
	}

	getPrivateKey(): Uint8Array {
		return this.privateKey;
	}

	getPrivateKeyPem(): string {
		return this._privateKeyPem;
	}
}
