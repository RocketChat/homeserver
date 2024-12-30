import type { Response as ServerKeysResponse } from '@hs/core/src/server';
import type { Server } from "../plugins/mongodb";
import type { WithId } from 'mongodb';
import { makeRequest } from "../makeRequest";
import {
	getSignaturesFromRemote,
	isValidAlgorithm,
	verifyJsonSignature,
} from "../signJson";

export const makeGetServerKeysFromServerProcedure = (
	getFromLocal: (origin: string, key: string) => Promise<WithId<Server> | null>,
	getFromOrigin: (origin: string, key: string) => Promise<ServerKeysResponse>,
	store: (origin: string, serverKeys: Omit<Server, '_id' | 'name'>) => Promise<void>,
) => {
	return async (origin: string, key: string) => {
		try {
			const localServerKeys = await getFromLocal(origin, key);
			if (localServerKeys) {
				return localServerKeys;
			}

			const result = await getFromOrigin(
				origin,
				key,
			);
			if (result) {
				await store(origin, result);
				return result;
			}
		} catch {
			return;
		}

		throw new Error("Keys not found");
	};
};

export const extractKeyFromServerKeys = (verifyKeys: Server['verify_keys'], key: string) => {
	const [, publickey] =
		Object.entries(verifyKeys).find(
			([keyFromServer]) => keyFromServer === key,
		) ?? [];

	if (!publickey) {
		throw new Error("Public key not found");
	}

	return publickey;
}

export const getPublicKeyFromRemoteServer = async (
	domain: string,
	origin: string,
	algorithmAndVersion: string,
) => {
	const result = await makeRequest({
		method: "GET",
		domain,
		uri: "/_matrix/key/v2/server",
		signingName: origin,
	});
	if (result.valid_until_ts < Date.now()) {
		throw new Error("Expired remote public key");
	}

	const [signature] = await getSignaturesFromRemote(result, domain);

	const publickey = extractKeyFromServerKeys(result.verify_keys, algorithmAndVersion);

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

	const [algorithm] = algorithmAndVersion.split(":");

	if (!isValidAlgorithm(algorithm)) {
		throw new Error("Invalid algorithm");
	}

	return result;
};