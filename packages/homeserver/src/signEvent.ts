import { computeAndMergeHash } from "./authentication";
import type { EventBase } from "@hs/core/src/events/eventBase";
import type { SigningKey } from "./keys";
import { pruneEventDict } from "./pruneEventDict";
import { signJson } from "./signJson";

export type SignedEvent<T extends EventBase> = T & {
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
): Promise<SignedEvent<T>> => {
	const s = await signJson(
		pruneEventDict(computeAndMergeHash(event)),
		signature,
		signingName,
	);

	return {
		...s,
		content: event.content,
		unsigned: event.unsigned,
	} as SignedEvent<T>;
};
