import type { EventBase } from '@hs/core/src/events/eventBase';
import { type SigningKey, type SignedEvent } from '@hs/federation-sdk';

export const signEvent = async <T extends EventBase>(
	event: T,
	signature: SigningKey,
	signingName: string,
): Promise<SignedEvent<T>> => {
	// Dynamically import dependencies to avoid circular dependencies
	const [{ computeAndMergeHash }, { pruneEventDict }] = await Promise.all([
		import('./authentication'),
		import('./pruneEventDict'),
	]);
	// Compute hash and sign
	const eventToSign = pruneEventDict(computeAndMergeHash(event));
	const { signJson } = await import('@hs/federation-sdk');
	const signedJsonResult = await signJson(eventToSign, signature, signingName);
	// For non-redaction events, restore the original content

	return {
		...signedJsonResult,
		content: event.content,
		unsigned: event.unsigned,
	} as SignedEvent<T>;
};
