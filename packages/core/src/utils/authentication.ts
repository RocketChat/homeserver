import { encodeCanonicalJson } from '@rocket.chat/federation-crypto';
import { type Pdu, PersistentEventBase } from '@rocket.chat/federation-room';
import nacl from 'tweetnacl';

import { type SigningKey } from '../types';
import { signJson } from './signJson';

// values may be quoted strings or bare tokens (RFC 9110); e.g. ruma only quotes values that need it.
// The lookbehind anchors names at token boundaries, so `x-origin` isn't read as `origin` and matching stays linear.
const AUTH_PARAM_REGEX = /(?<![\w!#$%&'*+.^`|~-])([\w!#$%&'*+.^`|~-]+)=(?:"((?:[^"\\]|\\.)*)"|([^\s,"]+))/g;

/**
 * Extracts the origin, destination, key, and signature from the authorization header.
 *
 * @param authorizationHeader The authorization header.
 * @returns An object containing the origin, optional destination, key, and signature.
 */
export const extractSignaturesFromHeader = (authorizationHeader: string) => {
	const params: Record<string, string> = {};
	for (const [, name, quoted, token] of authorizationHeader.matchAll(AUTH_PARAM_REGEX)) {
		params[name.toLowerCase()] = quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : token;
	}

	// destination is optional: servers predating spec v1.3 don't send it
	const { origin, destination, key, sig: signature } = params;
	if (!origin || !key || !signature) {
		throw new Error('Invalid authorization header');
	}

	return {
		origin,
		destination,
		key,
		signature,
	};
};

export async function authorizationHeaders<T extends object>(
	origin: string,
	signingKey: SigningKey,
	destination: string,
	method: string,
	uri: string,
	content?: T,
): Promise<string> {
	const signedJson = await signRequest(origin, signingKey, destination, method, uri, content);

	const key = `${signingKey.algorithm}:${signingKey.version}` as const;
	const signed = signedJson.signatures[origin][key];

	return `X-Matrix origin="${origin}",destination="${destination}",key="${key}",sig="${signed}"`;
}

export const validateAuthorizationHeader = async <T extends object>(
	origin: string,
	signingKey: string,
	destination: string,
	method: string,
	uri: string,
	hash: string,
	content?: T,
) => {
	const canonicalJson = encodeCanonicalJson({
		method,
		uri,
		origin,
		destination,
		...(content && { content }),
	});

	const signature = Uint8Array.from(atob(hash as string), (c) => c.charCodeAt(0));
	const signingKeyBytes = Uint8Array.from(atob(signingKey as string), (c) => c.charCodeAt(0));
	const messageBytes = new TextEncoder().encode(canonicalJson);
	const isValid = nacl.sign.detached.verify(messageBytes, signature, signingKeyBytes);

	if (!isValid) {
		throw new Error(`Invalid signature from ${origin} for request to ${destination}`);
	}

	return true;
};

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

export function computeAndMergeHash<T extends Record<string, unknown>>(content: T): HashedEvent<T> {
	// remove the fields that are not part of the hash
	const { age_ts, unsigned, signatures, hashes, outlier, destinations, ...toHash } = content;

	const [algorithm, hash] = computeHash(toHash);

	return {
		...content,
		hashes: {
			[algorithm]: hash,
		},
	};
}

export function computeHash<T extends Record<string, unknown>>(content: T, algorithm: 'sha256' = 'sha256'): ['sha256', string] {
	// remove the fields that are not part of the hash
	return [
		algorithm,
		PersistentEventBase.getContentHashString(
			content as unknown as Pdu, // content hash doesn't care about room version or event version, it is ok to pass anything.
		),
	];
}
