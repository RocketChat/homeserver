import type { EventBase } from '@hs/core/src/events/eventBase';
import type { SigningKey } from './keys';

export type SignedEvent<T extends EventBase> = T & {
	event_id: string;
	hashes: {
		sha256: string;
	};
	signatures: {
		[key: string]: {
			[key: string]: string;
		};
	};
};

export const signEvent = async <T extends EventBase>(
	event: T,
	signature: SigningKey,
	signingName: string,
	prune = true,
): Promise<SignedEvent<T>> => {
	// For non-redaction e// Dynamically import dependencies to avoid circular dependencies
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

	return {
		...signedJsonResult,
		content: event.content,
		unsigned: event.unsigned,
	} as SignedEvent<T>;
};
