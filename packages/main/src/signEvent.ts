import { computeHash } from "./authentication";
import type { SigningKey } from "./keys";
import { pruneEventDict } from "./pruneEventDict";
import { EncryptionValidAlgorithm, signJson, signText } from "./signJson";

export const signEvent = async (event, signature: SigningKey) => {
	return {
		...(await signJson(pruneEventDict(computeHash(event)), signature)),
		content: event.content,
	};
};
