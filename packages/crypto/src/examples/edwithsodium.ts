import {
	EncryptionValidAlgorithm,
	DataType,
	SignatureType,
} from '../constants';
import { SigningKey } from '../signing-key';

import { SodiumPlus } from 'sodium-plus';

const sodium = await SodiumPlus.auto();

// import {} from 'sodium-native';

const {
	crypto_sign_seed_keypair,

	crypto_sign_secretkey,
	crypto_sign_publickey,
	crypto_sign_detached,
	crypto_sign_verify_detached,
} = await sodium;

export class SodiumEd25519Impl implements SigningKey {
	algorithm: EncryptionValidAlgorithm = EncryptionValidAlgorithm.ed25519;
	version = '0';

	private secretKey?: any;
	private publicKey?: any;

	constructor(_seed: string) {}

	async load() {
		const seedBytes = Buffer.from(new Uint8Array(32));
		const key = await crypto_sign_seed_keypair(seedBytes);

		const secretKey = await crypto_sign_secretkey(key);
		const publicKey = await crypto_sign_publickey(key);

		this.secretKey = secretKey;
		this.publicKey = publicKey;
	}

	async sign(data: DataType): Promise<SignatureType> {
		const message =
			typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
		const signature = await crypto_sign_detached(message, this.secretKey!);

		return Promise.resolve(signature);
	}

	verify(data: DataType, signature: SignatureType): Promise<void> {
		const message =
			typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
		const isValid = crypto_sign_verify_detached(
			message,
			this.publicKey!,
			Buffer.from(signature),
		);

		if (!isValid) {
			return Promise.reject(new Error('Invalid signature'));
		}

		return Promise.resolve();
	}
}
