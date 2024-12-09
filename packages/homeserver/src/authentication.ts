import crypto from "node:crypto";

import { toUnpaddedBase64 } from "./binaryData";
import type { SigningKey } from "./keys";
import { pruneEventDict } from "./pruneEventDict";
import { encodeCanonicalJson, signJson } from "./signJson";

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

export type HashedEvent<T extends Record<string, unknown>> = T & {
	hashes: {
		sha256: string;
	};
};

export function computeHash<T extends Record<string, unknown>>(
	content: T,
): HashedEvent<T> {
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

/**
 * Extracts the origin, destination, key, and signature from the authorization header.
 *
 * @param authorizationHeader The authorization header.
 * @returns An object containing the origin, destination, key, and signature.
 */

export const extractSignaturesFromHeader = (authorizationHeader: string) => {
	// `X-Matrix origin="${origin}",destination="${destination}",key="${key}",sig="${signed}"`

	const regex = /\b(origin|destination|key|sig)="([^"]+)"/g;
	const {
		origin,
		destination,
		key,
		sig: signature,
		...rest
	} = Object.fromEntries(
		[...authorizationHeader.matchAll(regex)].map(
			([, key, value]) => [key, value] as const,
		),
	);

	if (Object.keys(rest).length) {
		// it should never happen since the regex should match all the parameters
		throw new Error("Invalid authorization header, unexpected parameters");
	}

	if ([origin, destination, key, signature].some((value) => !value)) {
		throw new Error("Invalid authorization header");
	}

	return {
		origin,
		destination,
		key,
		signature,
	};
};
