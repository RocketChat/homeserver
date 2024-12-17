import { makeRequest } from "../makeRequest";
import {
	getSignaturesFromRemote,
	isValidAlgorithm,
	verifyJsonSignature,
} from "../signJson";

export const makeGetPublicKeyFromServerProcedure = (
	getFromLocal: (origin: string, key: string) => Promise<string | undefined>,
	getFromOrigin: (
		origin: string,
	) => Promise<{ key: string; validUntil: number }>,
	store: (
		origin: string,
		key: string,
		value: string,
		validUntil: number,
	) => Promise<void>,
) => {
	return async (origin: string, key: string) => {
		const localPublicKey = await getFromLocal(origin, key);
		if (localPublicKey) {
			return localPublicKey;
		}

		const { key: remotePublicKey, validUntil } = await getFromOrigin(origin);
		if (remotePublicKey) {
			await store(origin, key, remotePublicKey, validUntil);
			return remotePublicKey;
		}

		throw new Error("Public key not found");
	};
};

export const getPublicKeyFromRemoteServer = async (
	domain: string,
	signingName: string,
	algorithmAndVersion: string,
) => {
	const result = await makeRequest({
		method: "GET",
		domain,
		uri: "/_matrix/key/v2/server",
		signingName,
	});
	if (result.valid_until_ts < Date.now()) {
		throw new Error("Expired remote public key");
	}

	const [signature] = await getSignaturesFromRemote(result, domain);

	const [, publickey] =
		Object.entries(result.verify_keys).find(
			([key]) => key === algorithmAndVersion,
		) ?? [];

	if (!publickey) {
		throw new Error("Public key not found");
	}

	if (!signature) {
		throw new Error(`Signatures not found for ${domain}`);
	}

	if (
		!(await verifyJsonSignature(
			result,
			domain,
			Uint8Array.from(atob(signature.signature), (c) => c.charCodeAt(0)),
			Uint8Array.from(atob(publickey.key), (c) => c.charCodeAt(0)),
			signature.algorithm,
			signature.version,
		))
	) {
		throw new Error("Invalid signature");
	}

	const [algorithm, version] = algorithmAndVersion.split(":");

	if (!isValidAlgorithm(algorithm)) {
		throw new Error("Invalid algorithm");
	}

	return {
		key: publickey.key,
		validUntil: result.valid_until_ts,
	};
};
