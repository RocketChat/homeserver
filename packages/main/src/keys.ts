import nacl from "tweetnacl";
import { toUnpaddedBase64 } from "./binaryData";

export async function generateKeyPairs(
	seed: Uint8Array,
	algorithm = "ed25519",
	version = "0",
) {
	// Generate an Ed25519 key pair
	const keyPair = await nacl.sign.keyPair.fromSeed(seed);

	// Encode the private key to Base64

	return [
		{
			version,
			privateKey: keyPair.secretKey,
			publicKey: keyPair.publicKey,
			algorithm,
		},
	];
}

async function storeKeyPairs(
	seeds: {
		algorithm: string;
		version: string;
		seed: Uint8Array;
	}[],
	path: string,
) {
	for await (const keyPair of seeds) {
		await Bun.write(
			path,
			`${keyPair.algorithm} ${keyPair.version} ${toUnpaddedBase64(keyPair.seed)}`,
		);
	}
}

export const getKeyPair = async (config: {
	signingKeyPath: string;
}): Promise<
	{
		algorithm: string;
		version: string;
		publicKey: Uint8Array;
		privateKey: Uint8Array;
	}[]
> => {
	const { signingKeyPath } = config;

	const hasStoredKeys = await Bun.file(signingKeyPath).exists();

	const seeds = [];

	if (!hasStoredKeys) {
		seeds.push({
			algorithm: "ed25519",
			version: "0",
			seed: nacl.randomBytes(32),
		});

		await storeKeyPairs(seeds, signingKeyPath);
	}

	if (hasStoredKeys) {
		const [algorithm, version, seed] = (
			await Bun.file(config.signingKeyPath).text()
		)
			.trim()
			.split(" ");
		seeds.push({
			algorithm,
			version,
			seed: Uint8Array.from(atob(seed), (c) => c.charCodeAt(0)),
		});
	}

	return await generateKeyPairs(
		seeds[0].seed,
		seeds[0].algorithm,
		seeds[0].version,
	);
};
