import {
	VerifierKey,
	fromBase64ToBytes,
	loadEd25519SignerFromSeed,
} from '@hs/crypto';

const seed = 'zSkmr713LnEDbxlkYq2ZqIiKTQNsyMOU0T2CEeC44C4';

const version = '0';

const signer = await loadEd25519SignerFromSeed(
	fromBase64ToBytes(seed),
	version,
);

const verifier: VerifierKey = signer;

export { verifier, signer };
