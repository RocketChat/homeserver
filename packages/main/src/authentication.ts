import crypto from "node:crypto";

import { toUnpaddedBase64 } from "./binaryData";
import {
	encodeCanonicalJson,
	type EncryptionValidAlgorithm,
	signJson,
} from "./signJson";
import { pruneEventDict } from "./pruneEventDict";
import type { SigningKey } from "./keys";

export async function authorizationHeaders<T extends object>(
	origin: string,
	signingKey: SigningKey,
	destination: string,
	method: string,
	uri: string,
	content?: T,
): Promise<string> {
	const signedJson = await signRequest(
		origin,
		signingKey,
		destination,
		method,
		uri,
		content,
	);

	const key = `${signingKey.algorithm}:${signingKey.version}` as const;
	const signed = signedJson.signatures[origin][key];

	return `X-Matrix origin="${origin}",destination="${destination}",key="${key}",sig="${signed}"`;
}

export async function signRequest<T extends object>(
	origin: string,
	signingKey: SigningKey,
	destination: string,
	method: string,
	uri: string,
	content?: T,
) {
	const signedJson = await signJson(
		{
			method,
			uri,
			origin,
			destination,
			...(content && { content }),
			signatures: {},
		},
		signingKey,
		origin,
	);

	return signedJson;
}

export function computeHash<T extends object>(
	content: T,
): T & { hashes: { sha256: string } } {
	// remove the fields that are not part of the hash
	const {
		age_ts,
		unsigned,
		signatures,
		hashes,
		outlier,
		destinations,
		...toHash
	} = content as any;

	return {
		...content,
		hashes: {
			sha256: toUnpaddedBase64(
				crypto
					.createHash("sha256")
					.update(encodeCanonicalJson(toHash))
					.digest(),
			),
		},
	};
}

export function generateId<T extends object>(content: T): string {
	// remove the fields that are not part of the hash
	const { age_ts, unsigned, signatures, ...toHash } = pruneEventDict(
		content as any,
	);

	return `\$${toUnpaddedBase64(
		crypto.createHash("sha256").update(encodeCanonicalJson(toHash)).digest(),
		{ urlSafe: true },
	)}`;
}
