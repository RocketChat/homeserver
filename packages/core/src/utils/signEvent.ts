import type { EventBase } from '../events/eventBase';
import type { SignedEvent } from '../types';
import type { SigningKey } from '../types';
import { computeAndMergeHash } from './authentication';
import { pruneEventDict } from './pruneEventDict';
import { signJson } from './signJson';

export const signEvent = async <T extends EventBase>(
	event: T,
	signature: SigningKey,
	signingName: string,
): Promise<SignedEvent<T>> => {
	// Compute hash and sign
	const eventToSign = pruneEventDict(computeAndMergeHash(event));
	const signedJsonResult = await signJson(eventToSign, signature, signingName);
	// For non-redaction events, restore the original content

	return {
		...signedJsonResult,
		content: event.content,
		unsigned: event.unsigned,
	} as SignedEvent<T>;
};
