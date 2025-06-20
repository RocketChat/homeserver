import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { toUnpaddedBase64 } from '../../binaryData';
import { ServerKeyResponseDto } from '../../dtos';
import type { SigningKey } from '../../keys';
import { ConfigService } from '../../services/config.service';
import { signJson } from '../../signJson';

export const serverKeyPlugin = (app: Elysia) => {
	const configService = container.resolve(ConfigService);
	return app.get('/_matrix/key/v2/server', async () => {
		const config = configService.getConfig();
		const signingKeys = await configService.getSigningKey();

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
	}, {
		response: {
			200: ServerKeyResponseDto,
		},
		detail: {
			tags: ['Key'],
			summary: 'Get server key',
			description: 'Get the server key'
		}
	});
};
