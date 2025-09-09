import express from 'express';
import nacl from 'tweetnacl';

import { encodeCanonicalJson } from '../../packages/crypto/src';
import { loadEd25519SignerFromSeed } from '../../packages/crypto/src/utils/keys';

const app = express();

app.use(express.json());

type SignAndVerifyRequest = {
	message: string | object; // allow big payloads
	api: {
		engine: 'native' | 'tweetnacl'; // sodium
		stream: boolean; // whether to use streaming API or not
	};
};

const seedBytes = new Uint8Array(32).fill(1); // for testing, should be random in real world
const tweetKeyPair = nacl.sign.keyPair.fromSeed(seedBytes);

function handleTweetnaclSignAndVerify(message: Uint8Array) {
	const signature = nacl.sign.detached(message, tweetKeyPair.secretKey);

	nacl.sign.detached.verify(message, signature, tweetKeyPair.publicKey);
}

const nativeSigner = await loadEd25519SignerFromSeed(seedBytes);

async function handleNativeSignAndVerify(message: Uint8Array, stream: boolean) {
	if (!stream) {
		const signature = await nativeSigner.sign(message);
		await nativeSigner.verify(message, signature);
		return;
	}
}

// @ts-ignore
app.post('/signAndVerify', async (req, res) => {
	const { message, api } = req.body as SignAndVerifyRequest;
	if (!message) {
		return res.status(400).json({ error: 'Message cannot be empty' });
	}

	const { engine, stream = false } = api;

	// encode should mimick copy of memory that we'll experience in real world, json -> string
	const encodedMessage = new TextEncoder().encode(
		typeof message === 'string' ? message : encodeCanonicalJson(message),
	);

	if (engine === 'tweetnacl') {
		if (stream) {
			return res
				.status(400)
				.json({ error: 'Stream not supported for tweetnacl' });
		}

		try {
			handleTweetnaclSignAndVerify(encodedMessage);
			return res.json({ success: true });
		} catch (e) {
			console.error('Tweetnacl sign/verify error', e);
			return res.status(500).json({ error: 'Signing or verification failed' });
		}
	}

	if (engine === 'native') {
		try {
			await handleNativeSignAndVerify(encodedMessage, stream);
			return res.json({ success: true });
		} catch (e) {
			console.error('Native sign/verify error', e);
			return res.status(500).json({ error: 'Signing or verification failed' });
		}
	}

	return res.status(400).json({ error: 'Invalid engine' });
});

const port = Number.parseInt(process.env.PORT || '', 10) || 8080;

app.listen(port, '127.0.0.1', () => console.log(`Listening on ${port}`));
