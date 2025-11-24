import { encodeCanonicalJson } from '@rocket.chat/federation-crypto';
import nacl from 'tweetnacl';
import type { SigningKey } from '../types';
import { EncryptionValidAlgorithm } from '../types';
import { toBinaryData, toUnpaddedBase64 } from './binaryData';

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
