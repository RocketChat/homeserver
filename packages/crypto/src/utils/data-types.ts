import crypto from 'node:crypto';

// computeJsonHashBuffer computes the hash of a JSON object using the specified algorithm (default is sha256).
export function computeHashBuffer<T extends Record<string, unknown>>(
	content: T,
	algorithm: 'sha256' = 'sha256',
): Buffer<ArrayBufferLike> {
	// making sure same JSON always results in same hash
	const canonicalisedJson = encodeCanonicalJson(content);
	return crypto.createHash(algorithm).update(canonicalisedJson).digest();
}

// computeJsonHashString computes the hash of a JSON object and returns it as a UNPADDED base64 string.
export function computeHashString<T extends Record<string, unknown>>(
	content: T,
	algorithm = 'sha256' as const,
) {
	return toUnpaddedBase64(computeHashBuffer(content, algorithm));
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

// uses JSON.stringify for primitives to ensure correct behaviour across the board, like, escaping characters
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
			`${JSON.stringify(key)}:${encodeCanonicalJson((value as Record<string, unknown>)[key])}`,
	);
	return `{${serializedEntries.join(',')}}`;
}

export function toSeedBytes(seed: string): Uint8Array {
	return Uint8Array.from(atob(seed), (c) => c.charCodeAt(0));
}
