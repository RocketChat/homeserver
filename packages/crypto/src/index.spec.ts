import { describe, expect, it } from 'bun:test';
import {
	EncryptionValidAlgorithm,
	encodeCanonicalJson,
	signJson,
	toBinaryData,
	verifySignature,
} from '.';

describe('signJson', () => {
	it('should sign a json object', async () => {
		const json = {
			method: 'PUT',
			uri: '/_matrix/federation/v1/send/1743489715804',
			origin: 'syn1.tunnel.dev.rocket.chat',
			destination: 'syn2.tunnel.dev.rocket.chat',
			content: {
				edus: [
					{
						content: {
							push: [
								{
									last_active_ago: 45931,
									presence: 'offline',
									user_id: '@debdut:syn1.tunnel.dev.rocket.chat',
								},
							],
						},
						edu_type: 'm.presence',
					},
				],
				origin: 'syn1.tunnel.dev.rocket.chat',
				origin_server_ts: 1743490730808,
				pdus: [],
			},
			// signatures: {
			// 	["syn1.tunnel.dev.rocket.chat"]: {
			// 		["ed25519:a_FAET"]: "ZDz7K7NRz0OwgR6n96YMIyt9h8KUCb7T9TklId7S1UDVOwc2y45+tC12/51kxRxpUkaOgr+iBtSBBh74BIrsBQ",
			// 	}
			// }
		};

		const seed = 'FC6cwY3DNmHo3B7GRugaHNyXz+TkBRVx8RvQH0kSZ04';

		const signature = await signJson(json, seed);

		expect(signature).toBe(
			'ZDz7K7NRz0OwgR6n96YMIyt9h8KUCb7T9TklId7S1UDVOwc2y45+tC12/51kxRxpUkaOgr+iBtSBBh74BIrsBQ',
		);
	});

	it('should verify a signature', async () => {
		const json = {
			method: 'PUT',
			uri: '/_matrix/federation/v1/send/1743489715804',
			origin: 'syn1.tunnel.dev.rocket.chat',
			destination: 'syn2.tunnel.dev.rocket.chat',
			content: {
				edus: [
					{
						content: {
							push: [
								{
									last_active_ago: 45931,
									presence: 'offline',
									user_id: '@debdut:syn1.tunnel.dev.rocket.chat',
								},
							],
						},
						edu_type: 'm.presence',
					},
				],
				origin: 'syn1.tunnel.dev.rocket.chat',
				origin_server_ts: 1743490730808,
				pdus: [],
			},
		};

		const signature =
			'ZDz7K7NRz0OwgR6n96YMIyt9h8KUCb7T9TklId7S1UDVOwc2y45+tC12/51kxRxpUkaOgr+iBtSBBh74BIrsBQ';

		const keyv2serverresponsefromorigin = {
			old_verify_keys: {},
			server_name: 'syn1.tunnel.dev.rocket.chat',
			signatures: {
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'MZF+8pncxhUNp7JzdSTIqriaANQ4QTYTe1AIqBNAtVhWcKz1Mc/6nzkP3/1HXZHAzCLYrmuFnTGb874XT4TJDg',
				},
			},
			valid_until_ts: 1747753307525,
			verify_keys: {
				'ed25519:a_FAET': {
					key: 'kryovKVnhHESOdWuZ05ViNotRMVdEh/mG2yJ0npLzEo',
				},
			},
		};

		const verifyKey =
			keyv2serverresponsefromorigin.verify_keys['ed25519:a_FAET'].key;

		const content = encodeCanonicalJson(json);

		await verifySignature(
			content,
			new Uint8Array(Buffer.from(signature, 'base64')),
			new Uint8Array(Buffer.from(verifyKey, 'base64')),
			{
				algorithm: EncryptionValidAlgorithm.ed25519,
				signingName: 'syn1.tunnel.dev.rocket.chat',
			},
		);
	});
});
