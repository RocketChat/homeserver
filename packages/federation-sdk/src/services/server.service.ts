import {
	type SigningKey,
	getPublicKeyFromRemoteServer,
	signJson,
	toUnpaddedBase64,
} from '@rocket.chat/federation-core';
import { delay, inject, singleton } from 'tsyringe';
import { ServerRepository } from '../repositories/server.repository';
import { ConfigService } from './config.service';

@singleton()
export class ServerService {
	constructor(
		@inject(delay(() => ServerRepository))
		private readonly serverRepository: ServerRepository,
		private configService: ConfigService,
	) {}

	async getValidPublicKeyFromLocal(
		origin: string,
		key: string,
	): Promise<string | undefined> {
		return await this.serverRepository.getValidPublicKeyFromLocal(origin, key);
	}

	async storePublicKey(
		origin: string,
		key: string,
		value: string,
		validUntil: number,
	): Promise<void> {
		await this.serverRepository.storePublicKey(origin, key, value, validUntil);
	}

	async getPublicKey(origin: string, key: string): Promise<string> {
		if (origin === this.configService.serverName) {
			return this.configService.getPublicSigningKeyBase64();
		}

		const localPublicKey =
			await this.serverRepository.getValidPublicKeyFromLocal(origin, key);
		if (localPublicKey) {
			return localPublicKey;
		}

		const { key: remotePublicKey, validUntil } =
			await getPublicKeyFromRemoteServer(
				origin,
				this.configService.serverName,
				key,
			);

		if (!remotePublicKey) {
			throw new Error('Could not get public key from remote server');
		}

		await this.storePublicKey(origin, key, remotePublicKey, validUntil);
		return remotePublicKey;
	}

	async getSignedServerKey() {
		const signer = await this.configService.getSigningKey();

		const keys = {
			[signer.id]: {
				key: toUnpaddedBase64(signer.getPublicKey()),
			},
		};

		const response = {
			old_verify_keys: {},
			server_name: this.configService.serverName,
			// TODO: what should this actually be and how to handle the expiration
			valid_until_ts: new Date().getTime() + 60 * 60 * 24 * 1000, // 1 day
			verify_keys: keys,
		};

		const responseSignature = await signJson(response, signer);

		const signatures = {
			[this.configService.serverName]: {
				[signer.id]: responseSignature,
			},
		};

		return {
			...response,
			signatures,
		};
	}
}
