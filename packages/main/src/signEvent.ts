import { computeHash } from "./authentication";
import { pruneEventDict } from "./pruneEventDict";
import { EncryptionValidAlgorithm, signJson, signText } from "./signJson";

export const signEvent = async (event, signature, signatureVersion) => {
	return {
		...(await signJson(
			pruneEventDict(computeHash(event)),
			{
				algorithm: EncryptionValidAlgorithm.ed25519,
				version: signatureVersion,
				sign(data: Uint8Array) {
					return signText(data, signature.privateKey);
				},
			},
			"hs1",
		)),
		content: event.content,
	};
};
