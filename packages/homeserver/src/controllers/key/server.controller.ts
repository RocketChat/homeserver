import { Controller, Get } from '@nestjs/common';
import { toUnpaddedBase64 } from '../../binaryData';
import type { SigningKey } from '../../keys';
import { ConfigService } from '../../services/config.service';
import { signJson } from '../../signJson';

@Controller('/_matrix/key/v2')
export class ServerController {
	constructor(private readonly configService: ConfigService) {}

	@Get('/server')
	async server() {
		const config = this.configService.getConfig();
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
			server_name: config.server.name,
			signatures: {},
			valid_until_ts: new Date().getTime() + 60 * 60 * 24 * 1000, // 1 day
			verify_keys: keys,
		};

		let signedResponse = baseResponse;
		for (const key of signingKeys) {
			signedResponse = await signJson(signedResponse, key, config.server.name);
		}

		return signedResponse;
	}
}
