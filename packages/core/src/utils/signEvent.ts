import type { EventBase, SignedEvent, SigningKey } from '@hs/core';

export const signEvent = async <T extends EventBase>(
	event: T,
	signature: SigningKey,
	signingName: string,
	prune = true,
): Promise<SignedEvent<T>> => {
	// Dynamically import dependencies to avoid circular dependencies
	const [{ computeAndMergeHash }, { pruneEventDict }] = await Promise.all([
		import('./authentication'),
		import('./pruneEventDict'),
	]);
	// Compute hash and sign
	const eventToSign = prune
		? pruneEventDict(computeAndMergeHash(event))
		: event;
	const { signJson } = await import('./signJson');
	const signedJsonResult = await signJson(eventToSign, signature, signingName);
	// For non-redaction events, restore the original content

	return {
		...signedJsonResult,
		content: event.content,
		unsigned: event.unsigned,
	} as SignedEvent<T>;
};
