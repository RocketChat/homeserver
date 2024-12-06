import { generateId } from "../../authentication";
import type { SigningKey } from "../../keys";
import { signEvent } from "../../signEvent";

export const createSignedEvent = (signature: SigningKey) => {
	return <F extends (...args: any) => any>(fn: F) => {
		return async (...args: Parameters<F>): Promise<ReturnType<F>> => {
			return signEvent(await fn(...args), signature) as Promise<ReturnType<F>>;
		};
	};
};

export const createEventWithId = <F extends (...args: any) => any>(fn: F) => {
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
