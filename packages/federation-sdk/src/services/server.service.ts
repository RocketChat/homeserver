import { type SigningKey, getPublicKeyFromRemoteServer, signJson, toUnpaddedBase64 } from '@rocket.chat/federation-core';
import { delay, inject, singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { ServerRepository } from '../repositories/server.repository';

@singleton()
export class ServerService {
	constructor(
		@inject(delay(() => ServerRepository))
		private readonly serverRepository: ServerRepository,
		private configService: ConfigService,
	) {}

	async getValidPublicKeyFromLocal(origin: string, key: string): Promise<string | undefined> {
		return await this.serverRepository.getValidPublicKeyFromLocal(origin, key);
	}

	async storePublicKey(origin: string, key: string, value: string, validUntil: number): Promise<void> {
		await this.serverRepository.storePublicKey(origin, key, value, validUntil);
	}

	async getPublicKey(origin: string, key: string): Promise<string> {
		if (origin === this.configService.serverName) {
			return this.configService.getPublicSigningKeyBase64();
		}

		const localPublicKey = await this.serverRepository.getValidPublicKeyFromLocal(origin, key);
		if (localPublicKey) {
			return localPublicKey;
		}

		const { key: remotePublicKey, validUntil } = await getPublicKeyFromRemoteServer(origin, this.configService.serverName, key);

		if (!remotePublicKey) {
			throw new Error('Could not get public key from remote server');
		}

		await this.storePublicKey(origin, key, remotePublicKey, validUntil);
		return remotePublicKey;
	}

	async getSignedServerKey() {
		const signingKeys = await this.configService.getSigningKey();

		const keys = Object.fromEntries(
			signingKeys.map((signingKey: SigningKey) => [
				`${signingKey.algorithm}:${signingKey.version}`,
				{
					key: toUnpaddedBase64(signingKey.publicKey),
				},
			]),
		);

		const baseResponse = {
			old_verify_keys: {},
			server_name: this.configService.serverName,
			signatures: {},
			valid_until_ts: new Date().getTime() + 60 * 60 * 24 * 1000, // 1 day
			verify_keys: keys,
		};

		let signedResponse = baseResponse;
		for (const key of signingKeys) {
			signedResponse = await signJson(signedResponse, key, this.configService.serverName);
		}

		return signedResponse;
	}
}
