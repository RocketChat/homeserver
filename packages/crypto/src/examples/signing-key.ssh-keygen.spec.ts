import { describe, it } from 'node:test';
// import { toUnpaddedBase64 } from '..';
import { SshKeygenSigningKey } from './signing-key.ssh-keygen';
import type { SigningKey } from '../signing-key';
import { Ed25519SigningKeyImpl } from './ed25519';

async function getsigningkey(): Promise<SigningKey> {
	const signingKey = new SshKeygenSigningKey({
		configDir: '/tmp',
	});

	await signingKey.load();

	return signingKey;
}

async function getedsigningkey(): Promise<SigningKey> {
	const signingkey = new Ed25519SigningKeyImpl('0');
	await signingkey.load(new Uint8Array(32));
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
});
