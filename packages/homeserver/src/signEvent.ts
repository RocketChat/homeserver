import type { EventBase } from "@hs/core/src/events/eventBase";
import type { SigningKey } from "./keys";

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
	// Dynamically import dependencies to avoid circular dependencies
	const [{ computeAndMergeHash }, { pruneEventDict }, redactionModule] = await Promise.all([
		import("./authentication"),
		import("./pruneEventDict"),
		import("@hs/core/src/events/m.room.redaction"),
	]);

	// Check if this is a redaction event
	const isRedactionEvent = redactionModule.isRedactionEvent;
	const isRedaction = isRedactionEvent(event);

	// Compute hash and sign
	const eventToSign = pruneEventDict(computeAndMergeHash(event));
	const { signJson } = await import("./signJson");
	const signedJsonResult = await signJson(eventToSign, signature, signingName);

	// For redaction events, ensure content doesn't include redacts
	if (isRedaction) {
		const redactsField = (event as any).redacts;
		return {
			...signedJsonResult,
			content: {
				...(event.content?.reason ? { reason: event.content.reason } : {})
			},
			unsigned: event.unsigned,
			redacts: redactsField
		} as SignedEvent<T>;
	}

	// For non-redaction events, restore the original content
	return {
		...signedJsonResult,
		content: event.content,
		unsigned: event.unsigned,
	} as SignedEvent<T>;
};
