import nacl from 'tweetnacl';
import { toBinaryData, toUnpaddedBase64 } from './binaryData';
import type { SigningKey } from '../types';
import { EncryptionValidAlgorithm } from '../types';

export type ProtocolVersionKey = `${EncryptionValidAlgorithm}:${string}`;

export type SignedJson<T extends object> = T & {
	signatures: {
		[key: string]: {
			[key: string]: string;
		};
	};
};

export async function signJson<
	T extends object & {
		signatures?: Record<string, Record<string, string>>;
		unsigned?: Record<string, any>;
	},
>(
	jsonObject: T,
	signingKey: SigningKey,
	signingName: string,
): Promise<SignedJson<T>> {
	const keyId =
		`${signingKey.algorithm}:${signingKey.version}` as ProtocolVersionKey;
	const { signatures = {}, unsigned, ...rest } = jsonObject;

	const data = encodeCanonicalJson(rest);

	const signed = await signingKey.sign(toBinaryData(data));

	const name = signingName;

	const signature = signatures[name] || {};

	Object.assign(signatures, {
		[name]: {
			...signature,
			[keyId]: toUnpaddedBase64(signed),
		},
	});

	return {
		...jsonObject,
		signatures,
	};
}

export const isValidAlgorithm = (
	algorithm: string,
): algorithm is EncryptionValidAlgorithm => {
	return Object.values(EncryptionValidAlgorithm).includes(algorithm as any);
};

export async function getSignaturesFromRemote<
	T extends object & {
		signatures?: Record<string, Record<ProtocolVersionKey, string>>;
		unsigned?: unknown;
	},
>(jsonObject: T, signingName: string) {
	const { signatures, unsigned: _unsigned /*..._rest */ } = jsonObject;
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
	signingName: string,
	signature: Uint8Array,
	publicKey: Uint8Array,
	algorithm: EncryptionValidAlgorithm,
	_version: string,
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
	return true;
};

export const verifyJsonSignature = <T extends object>(
	content: T,
	signingName: string,
	signature: Uint8Array,
	publicKey: Uint8Array,
	algorithm: EncryptionValidAlgorithm,
	version: string,
) => {
	const { signatures: _, unsigned: _unsigned, ...__rest } = content as any;
	const canonicalJson = encodeCanonicalJson(__rest);

	return verifySignature(
		canonicalJson,
		signingName,
		signature,
		publicKey,
		algorithm,
		version,
	);
};

export async function verifySignaturesFromRemote<
	T extends object & {
		signatures?: Record<string, Record<ProtocolVersionKey, string>>;
		unsigned?: unknown;
	},
>(
	jsonObject: T,
	signingName: string,
	getPublicKey: (
		algorithm: EncryptionValidAlgorithm,
		version: string,
	) => Promise<Uint8Array>,
) {
	const { signatures: _, unsigned: _unsigned, ...__rest } = jsonObject;

	const canonicalJson = encodeCanonicalJson(__rest);

	const signatures = await getSignaturesFromRemote(jsonObject, signingName);

	for await (const { algorithm, version, signature } of signatures) {
		const publicKey = await getPublicKey(
			algorithm as EncryptionValidAlgorithm,
			version,
		);

		if (
			!nacl.sign.detached.verify(
				new TextEncoder().encode(canonicalJson),
				new Uint8Array(Buffer.from(signature, 'base64')),
				publicKey,
			)
		) {
			throw new Error(`Invalid signature for ${signingName}`);
		}
	}

	return true;
}

export function encodeCanonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		// Handle primitive types and null
		if (typeof value === 'string') {
			return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
		}
		return String(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map(encodeCanonicalJson).join(',')}]`;
	}

	// Handle objects
	const keys = Object.keys(value as Record<string, unknown>).sort();
	const pairs = keys.map(
		(key) =>
			`"${key}":${encodeCanonicalJson((value as Record<string, unknown>)[key])}`,
	);
	return `{${pairs.join(',')}}`;
}

export async function signText(
	data: string | Uint8Array,
	signingKey: Uint8Array,
) {
	const signature = nacl.sign.detached(
		typeof data === 'string' ? new TextEncoder().encode(data) : data,
		signingKey,
	);

	return toUnpaddedBase64(signature);
}

export async function signData(
	data: string | Uint8Array,
	signingKey: Uint8Array,
): Promise<Uint8Array> {
	const signature = nacl.sign.detached(
		typeof data === 'string' ? new TextEncoder().encode(data) : data,
		signingKey,
	);

	return signature;
}
