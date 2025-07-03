import nacl from 'tweetnacl';

import crypto from 'node:crypto';

export function computeHash<T extends Record<string, unknown>>(
	content: T,
	algorithm: 'sha256' = 'sha256',
): ['sha256', string] {
	return [
		algorithm,
		toUnpaddedBase64(
			crypto
				.createHash(algorithm)
				.update(encodeCanonicalJson(content))
				.digest(),
		),
	];
}

export function toBinaryData(
	value: string | Uint8Array | ArrayBuffer | ArrayBufferView,
): Uint8Array {
	if (typeof value === 'string') {
		return new TextEncoder().encode(value);
	}

	if (value instanceof Uint8Array) {
		return value;
	}

	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}

	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function fromBinaryData(
	value: string | Uint8Array | ArrayBuffer,
): string {
	if (typeof value === 'string') {
		return value;
	}

	return new TextDecoder().decode(value);
}

export function toUnpaddedBase64(
	value: Uint8Array | Buffer,
	options: {
		urlSafe?: boolean;
	} = { urlSafe: false },
): string {
	const hash = btoa(String.fromCharCode(...value)).replace(/=+$/, '');

	if (!options.urlSafe) return hash;

	return hash.replace(/\+/g, '-').replace(/\//g, '_');
}

export enum EncryptionValidAlgorithm {
	ed25519 = 'ed25519',
}

type ProtocolVersionKey = `${EncryptionValidAlgorithm}:${string}`;

export function getKeyPairFromSeed(seed: string) {
	return nacl.sign.keyPair.fromSeed(
		Uint8Array.from(atob(seed), (c) => c.charCodeAt(0)),
	);
}

// returns the signature as a string
export async function signJson<T extends object>(
	jsonObject: T,
	seed: string,
): Promise<string> {
	const data = encodeCanonicalJson(jsonObject);

	const { secretKey } = getKeyPairFromSeed(seed);

	const signed = await nacl.sign.detached(toBinaryData(data), secretKey);

	return toUnpaddedBase64(signed);
}

export const isValidAlgorithm = (
	algorithm: string,
): algorithm is EncryptionValidAlgorithm => {
	return Object.values(EncryptionValidAlgorithm).includes(algorithm as any);
};

export function encodeCanonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		// Handle primitive types and null
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		// Handle arrays recursively
		const serializedArray = value.map(encodeCanonicalJson);
		return `[${serializedArray.join(',')}]`;
	}

	// Handle objects: sort keys lexicographically
	const sortedKeys = Object.keys(value).sort();
	const serializedEntries = sortedKeys.map(
		(key) =>
			`"${key}":${encodeCanonicalJson((value as Record<string, unknown>)[key])}`,
	);
	return `{${serializedEntries.join(',')}}`;
}

// Checking for a Signature
// To check if an entity has signed a JSON object an implementation does the following:

// Checks if the signatures member of the object contains an entry with the name of the entity. If the entry is missing then the check fails.
// Removes any signing key identifiers from the entry with algorithms it doesn’t understand. If there are no signing key identifiers left then the check fails.
// Looks up verification keys for the remaining signing key identifiers either from a local cache or by consulting a trusted key server. If it cannot find a verification key then the check fails.
// Decodes the base64 encoded signature bytes. If base64 decoding fails then the check fails.
// Removes the signatures and unsigned members of the object.
// Encodes the remainder of the JSON object using the Canonical JSON encoding.
// Checks the signature bytes against the encoded object using the verification key. If this fails then the check fails. Otherwise the check succeeds.

export async function getSignaturesFromRemote<
	T extends object & {
		signatures?: Record<string, Record<ProtocolVersionKey, string>>;
		unsigned?: unknown;
	},
>(jsonObject: T, signingName: string) {
	const { signatures, unsigned: _unsigned, ...__rest } = jsonObject;

	const remoteSignatures =
		signatures?.[signingName] &&
		Object.entries(signatures[signingName])
			.map(([keyId, signature]) => {
				const [algorithm, version] = keyId.split(':');
				if (!isValidAlgorithm(algorithm)) {
					throw new Error(`Invalid algorithm ${algorithm} for ${signingName}`);
				}

				return {
					algorithm,
					version,
					signature,
				};
			})
			.filter(({ algorithm }) =>
				Object.values(EncryptionValidAlgorithm).includes(algorithm as any),
			);

	if (!remoteSignatures?.length) {
		throw new Error(`Signatures not found for ${signingName}`);
	}

	return remoteSignatures;
}

export const verifySignature = (
	content: string,
	signature: Uint8Array,
	publicKey: Uint8Array,
	{
		algorithm,
		signingName,
	}: {
		algorithm: EncryptionValidAlgorithm;
		signingName: string;
	},
) => {
	if (algorithm !== EncryptionValidAlgorithm.ed25519) {
		throw new Error(`Invalid algorithm ${algorithm} for ${signingName}`);
	}

	if (
		!nacl.sign.detached.verify(
			new TextEncoder().encode(content),
			signature,
			publicKey,
		)
	) {
		throw new Error(`Invalid signature for ${signingName}`);
	}
};
