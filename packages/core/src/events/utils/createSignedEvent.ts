import type { SigningKey } from '@hs/federation-sdk';
import type { SignedEvent } from '@hs/federation-sdk';

export const createSignedEvent = (
	signature: SigningKey,
	signingName: string,
) => {
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	return <F extends (...args: any[]) => any>(fn: F) => {
		return async (
			...args: Parameters<F>
		): Promise<SignedEvent<ReturnType<F>>> => {
			const event = await fn(...args);
			const { signEvent } = await import('@hs/homeserver/src/signEvent');
			return signEvent(event, signature, signingName) as Promise<
				SignedEvent<ReturnType<F>>
			>;
		};
	};
};

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export const createEventWithId = <F extends (...args: any[]) => any>(fn: F) => {
	return <S extends ReturnType<typeof createSignedEvent>>(sign: S) => {
		return async (
			...args: Parameters<F>
		): Promise<{ event: SignedEvent<ReturnType<F>>; _id: string }> => {
			const event = await sign(fn)(...args);
			const { generateId } = await import('@hs/homeserver/src/authentication');
			const id = generateId(event);
			return {
				event,
				_id: id,
			};
		};
	};
};
