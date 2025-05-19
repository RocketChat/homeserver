import { generateId } from "../../../../homeserver/src/authentication";
import type { SigningKey } from "../../../../homeserver/src/keys";
import { signEvent } from "../../../../homeserver/src/signEvent";

export const createSignedEvent = (
	signature: SigningKey,
	signingName: string,
) => {
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	return <F extends (...args: any[]) => any>(fn: F) => {
		return async (...args: Parameters<F>): Promise<ReturnType<F>> => {
			return signEvent(await fn(...args), signature, signingName) as Promise<
				ReturnType<F>
			>;
		};
	};
};

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export const createEventWithId = <F extends (...args: any[]) => any>(fn: F) => {
	return <S extends ReturnType<typeof createSignedEvent>>(sign: S) => {
		return async (
			...args: Parameters<F>
		): Promise<{ event: ReturnType<F>; _id: string }> => {
			const event = await sign(fn)(...args);
			const id = generateId(event);
			return {
				event,
				_id: id,
			};
		};
	};
};
