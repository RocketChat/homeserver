import { computeHash } from "./authentication";
import { pruneEventDict } from "./pruneEventDict";
import { EncryptionValidAlgorithm, signJson, signText } from "./signJson";

export const signEvent = async (event, signature) => {
	return {
		...(await signJson(pruneEventDict(computeHash(event)), signature, "hs1")),
		content: event.content,
	};
};
