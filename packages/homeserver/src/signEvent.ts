import type { EventBase } from "@hs/core/src/events/eventBase";
import { computeAndMergeHash } from "./authentication";
import type { SigningKey } from "./keys";
import { pruneEventDict } from "./pruneEventDict";
import { signJson } from "./signJson";

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
): Promise<SignedEvent<T>> => {
	const eventToSign = pruneEventDict(computeAndMergeHash(event));

	const signedJsonResult = await signJson(eventToSign, signature, signingName);

	return {
		...signedJsonResult,
		content: event.content,
		unsigned: event.unsigned,
	} as SignedEvent<T>;
};
