import { describe, it, expect } from 'bun:test';
// import { toUnpaddedBase64 } from '..';
import { SshKeygenSigningKey } from './signing-key.ssh-keygen';
import type { SigningKey } from '../signing-key';
import { Ed25519SigningKeyImpl } from './ed25519';
import { encodeCanonicalJson, toBinaryData, toUnpaddedBase64 } from '..';

async function getsigningkey(): Promise<SigningKey> {
	const signingKey = new SshKeygenSigningKey({
		configDir: '/tmp',
	});

	await signingKey.load();

	return signingKey;
}

async function getedsigningkey(seed?: string): Promise<SigningKey> {
	const signingkey = new Ed25519SigningKeyImpl('0');
	// convert seed from base64 to Uint8Array
	const seedBytes = seed
		? Uint8Array.from(atob(seed), (c) => c.charCodeAt(0))
		: new Uint8Array(32);
	await signingkey.load(seedBytes);
	return signingkey;
}

describe('SshKeygenSigningKey', async () => {
	const signingKey = await getsigningkey();

	it('should sign and verify data', async () => {
		const data = 'Hello, World!';
		const signature = await signingKey.sign(data);

		// console.log(toUnpaddedBase64(signature));

		await signingKey.verify(data, signature);
	});

	it('should work with crypto + ed keys', async () => {
		const edsigningkey = await getedsigningkey();
		const data = 'Hello, World!';
		const signature = await edsigningkey.sign(data);

		await edsigningkey.verify(data, signature);
	});

	const seed = 'YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U';

	const key = await getedsigningkey(seed);

	it('should sign data correctly with seed', async () => {
		const data = new TextEncoder().encode('test data');
		const signature = await key.sign(data);

		// console.log(toUnpaddedBase64(signature));

		await key.verify(data, signature);
		// authentication.spec.ts

		const event = Object.freeze({
			auth_events: [
				'$KMCKA2rA1vVCoN3ugpEnAja70o0jSksI-s2fqWy_1to',
				'$DcuwuadjnOUTC-IZmPdWHfCyxEgzuYcDvAoNpIJHous',
				'$tMNgmLPOG2gBqdDmNaT2iAjD54UQYaIzPpiGplxF5J4',
				'$8KCjO1lBtHMCUAYwe8y4-FMTwXnzXUb6F2g_Y6jHr4c',
			],
			prev_events: ['$KYvjqKYmahXxkpD7O_217w6P6g6DMrUixsFrJ_NI0nA'],
			type: 'm.room.member',
			room_id: '!EAuqyrnzwQoPNHvvmX:hs1',
			sender: '@admin:hs2',
			depth: 10,

			content: {
				// avatar_url: null,
				// displayname: "admin",
				membership: 'join',
			},

			hashes: {
				sha256: 'WUqhTZqxv+8GhGQv58qE/QFQ4Oua5BKqGFQGT35Dv10',
			},
			origin: 'hs2',
			origin_server_ts: 1733069433734,

			state_key: '@admin:hs2',
			signatures: {
				hs2: {
					'ed25519:a_XRhW':
						'DR+DBqFTm7IUa35pFeOczsNw4shglIXW+3Ze63wC3dqQ4okzaSRgLuAUkYnVyxM2sZkSvlbeSBS7G6DeeaDEAA',
				},
			},
			unsigned: {
				age: 1,
			},
		});

		const { signatures, unsigned, ...rest } = event;

		const json = encodeCanonicalJson(rest);

		const newSignature = await key.sign(toBinaryData(json));

		expect(toUnpaddedBase64(newSignature)).toBe(
			event.signatures.hs2['ed25519:a_XRhW'],
		);
	});
});
