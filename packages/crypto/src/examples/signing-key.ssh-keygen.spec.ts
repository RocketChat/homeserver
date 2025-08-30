import { describe, it } from 'node:test';
import { getSshKeygenSigningKey } from './signing-key.ssh-keygen';

describe('SshKeygenSigningKey', async () => {
	const signingKey = await getSshKeygenSigningKey();

	it('should sign and verify data', async () => {
		const data = 'Hello, World!';
		const signature = await signingKey.sign(data);
		const isValid = await signingKey.verify(data, signature);
		if (!isValid) {
			throw new Error('Signature verification failed');
		}
	});
});
