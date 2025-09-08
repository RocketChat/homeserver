import { Pdu } from '@hs/room';
import type { SignedEvent } from '../types';
import type { SigningKey } from '../types';
import { computeAndMergeHash } from './authentication';
import { pruneEventDict } from './pruneEventDict';
import { signJson } from './signJson';

export const signEvent = async <T extends Pdu>(
	event: T,
	signature: SigningKey,
	signingName: string,
	prune = true,
): Promise<SignedEvent<T>> => {
	// Compute hash and sign
	const eventToSign = prune
		? pruneEventDict(computeAndMergeHash(event))
		: event;
	const signedJsonResult = await signJson(eventToSign, signature, signingName);
	// For non-redaction events, restore the original content

	return {
		...signedJsonResult,
		content: event.content,
		unsigned: event.unsigned,
	} as SignedEvent<T>;
};
