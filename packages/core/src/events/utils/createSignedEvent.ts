import { generateId } from "../../../../homeserver/src/authentication";
import type { SigningKey } from "../../../../homeserver/src/keys";
import { signEvent } from "../../../../homeserver/src/signEvent";

export const createSignedEvent = (
	signature: SigningKey,
	signingName: string,
) => {
	return <F extends (...args: unknown[]) => unknown>(fn: F) => {
		return async (...args: Parameters<F>): Promise<ReturnType<F>> => {
			return signEvent(await fn(...args) as any, signature, signingName) as Promise<
				ReturnType<F>
			>;
		};
	};
};

export const createEventWithId = <F extends (...args: unknown[]) => unknown>(fn: F) => {
	return <S extends ReturnType<typeof createSignedEvent>>(sign: S) => {
		return async (
			...args: Parameters<F>
		): Promise<{ event: ReturnType<F>; _id: string }> => {
			const event = await sign(fn)(...args);
			const id = generateId(event as any);
			return {
				event,
				_id: id,
			};
		};
	};
};
