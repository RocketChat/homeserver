import { toUnpaddedBase64, signJson } from '@hs/crypto';
import { singleton } from 'tsyringe';
import { ServerRepository } from '../repositories/server.repository';
import { ConfigService } from './config.service';

@singleton()
export class ServerService {
	constructor(
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

	async getSignedServerKey() {
		const signer = await this.configService.getSigningKey();

		const keys = {
			[signer.id]: {
				key: toUnpaddedBase64(signer.publicKey),
			},
		};

		const response = {
			old_verify_keys: {},
			server_name: this.configService.serverName,
			signatures: {},
			// TODO: what should this actually be and how to handle the expiration
			valid_until_ts: new Date().getTime() + 60 * 60 * 24 * 1000, // 1 day
			verify_keys: keys,
		};

		const responseSignature = await signJson(response, signer);

		response.signatures = {
			[this.configService.serverName]: {
				[signer.id]: responseSignature,
			},
		};

		return response;
	}
}
