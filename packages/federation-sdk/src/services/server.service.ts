import { type SigningKey, signJson, toUnpaddedBase64 } from '@hs/core';
import { inject, singleton } from 'tsyringe';
import type { ServerRepository } from '../repositories/server.repository';
import type { ConfigService } from './config.service';

@singleton()
export class ServerService {
	constructor(
		@inject('ServerRepository')
		private readonly serverRepository: ServerRepository,
		@inject('ConfigService') private configService: ConfigService,
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
			signedResponse = await signJson(
				signedResponse,
				key,
				this.configService.serverName,
			);
		}

		return signedResponse;
	}
}
