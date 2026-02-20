import type { SigningKey } from '../../types';
import type { SignedEvent } from '../../types';
import { generateId } from '../../utils/generateId';
import { signEvent } from '../../utils/signEvent';

export const createSignedEvent = (
	signature: SigningKey,
	signingName: string,
) => {
	return <F extends (...args: any[]) => any>(fn: F) => {
		return async (
			...args: Parameters<F>
		): Promise<SignedEvent<ReturnType<F>>> => {
			const event = await fn(...args);
			return signEvent(event, signature, signingName) as Promise<
				SignedEvent<ReturnType<F>>
			>;
		};
	};
};

export const createEventWithId = <F extends (...args: any[]) => any>(fn: F) => {
	return <S extends ReturnType<typeof createSignedEvent>>(sign: S) => {
		return async (
			...args: Parameters<F>
		): Promise<{ event: SignedEvent<ReturnType<F>>; _id: string }> => {
			const event = await sign(fn)(...args);
			const id = generateId(event);
			return {
				event,
				_id: id,
			};
		};
	};
};
