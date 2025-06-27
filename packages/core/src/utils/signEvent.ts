import type { EventBase } from '../events/eventBase';
import type { SignedEvent } from '../types';
import type { SigningKey } from '../types';

export const signEvent = async <T extends EventBase>(
	event: T,
	signature: SigningKey,
	signingName: string,
): Promise<SignedEvent<T>> => {
	const { signJson } = await import('./signJson');
	const signedJsonResult = await signJson(event, signature, signingName);
	// For non-redaction events, restore the original content

	return {
		...signedJsonResult,
		content: event.content,
		unsigned: event.unsigned,
	} as SignedEvent<T>;
};
