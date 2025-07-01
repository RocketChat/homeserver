import crypto from 'node:crypto';
import {
	authorizationHeaders,
	computeAndMergeHash,
	computeHash,
	extractSignaturesFromHeader,
	signRequest,
	validateAuthorizationHeader,
	type HashedEvent,
	toUnpaddedBase64,
	encodeCanonicalJson,
} from '@hs/federation-sdk';
import { pruneEventDict } from './pruneEventDict';
import { type SigningKey } from '@hs/core';

// Re-export all authentication functions from federation-sdk
export {
	authorizationHeaders,
	computeAndMergeHash,
	computeHash,
	extractSignaturesFromHeader,
	signRequest,
	validateAuthorizationHeader,
	type HashedEvent,
};

export function generateId<T extends object>(content: T): string {
	// remove the fields that are not part of the hash
	const { age_ts, unsigned, signatures, ...toHash } = pruneEventDict(
		content as any,
	);

	return `\$${toUnpaddedBase64(
		crypto.createHash('sha256').update(encodeCanonicalJson(toHash)).digest(),
		{ urlSafe: true },
	)}`;
}
