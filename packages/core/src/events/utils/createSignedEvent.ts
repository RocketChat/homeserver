import type { SigningKey, SignedEvent } from '../../types';
import { signEvent } from '../../utils/signEvent';

export const createSignedEvent = (signature: SigningKey, signingName: string) => {
	return <F extends (...args: any[]) => any>(fn: F) => {
		return async (...args: Parameters<F>): Promise<SignedEvent<ReturnType<F>>> => {
			const event = await fn(...args);
			return signEvent(event, signature, signingName) as Promise<SignedEvent<ReturnType<F>>>;
		};
	};
};
