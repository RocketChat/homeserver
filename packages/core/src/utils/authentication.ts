import {
	type Pdu,
	PersistentEventBase,
	PersistentEventFactory,
} from '@rocket.chat/federation-room';
import nacl from 'tweetnacl';
import { type SigningKey } from '../types';
import { encodeCanonicalJson, signJson } from './signJson';

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
		throw new Error('Invalid authorization header, unexpected parameters');
	}

	if ([origin, destination, key, signature].some((value) => !value)) {
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

	const signature = Uint8Array.from(atob(hash as string), (c) =>
		c.charCodeAt(0),
	);
	const signingKeyBytes = Uint8Array.from(atob(signingKey as string), (c) =>
		c.charCodeAt(0),
	);
	const messageBytes = new TextEncoder().encode(canonicalJson);
	const isValid = nacl.sign.detached.verify(
		messageBytes,
		signature,
		signingKeyBytes,
	);

	if (!isValid) {
		throw new Error(
			`Invalid signature from ${origin} for request to ${destination}`,
		);
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

export function computeAndMergeHash<T extends Record<string, unknown>>(
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
	} = content;

	const [algorithm, hash] = computeHash(toHash);

	return {
		...content,
		hashes: {
			[algorithm]: hash,
		},
	};
}

export function computeHash<T extends Record<string, unknown>>(
	content: T,
	algorithm: 'sha256' = 'sha256',
): ['sha256', string] {
	// remove the fields that are not part of the hash
	return [
		algorithm,
		PersistentEventBase.getContentHashString(
			content as unknown as Pdu, // content hash doesn't care about room version or event version, it is ok to pass anything.
		),
	];
}
