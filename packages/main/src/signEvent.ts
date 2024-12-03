import { computeHash } from "./authentication";
import type { SigningKey } from "./keys";
import { pruneEventDict } from "./pruneEventDict";
import { EncryptionValidAlgorithm, signJson, signText } from "./signJson";

export const signEvent = async (
	event,
	signature: SigningKey,
	signingName?: string,
) => {
	return {
		...(await signJson(
			pruneEventDict(computeHash(event)),
			signature,
			signingName,
		)),
		content: event.content,
		unsigned: event.unsigned,
	};
};
