import type { EventBase } from "@hs/core/src/events/eventBase";
import { computeHash, type HashedEvent } from "../authentication";
import { MatrixError } from "../errors";
import { pruneEventDict } from "../pruneEventDict";
import {
	getSignaturesFromRemote,
	verifyJsonSignature,
	type SignedJson,
} from "../signJson";

export async function checkSignAndHashes<T extends EventBase>(
	pdu: T,
	origin: string,
	getPublicKeyFromServer: (origin: string, key: string) => Promise<string>,
): Promise<SignedJson<HashedEvent<T>>> {
	const { hashes, ...rest } = pdu as SignedJson<HashedEvent<T>>;

	const [signature] = await getSignaturesFromRemote(pdu, origin);

	const publicKey = await getPublicKeyFromServer(
		origin,
		`${signature.algorithm}:${signature.version}`,
	);

	if (
		!verifyJsonSignature(
			pruneEventDict(pdu),
			origin,
			Uint8Array.from(atob(signature.signature), (c) => c.charCodeAt(0)),
			Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0)),
			signature.algorithm,
			signature.version,
		)
	) {
		throw new MatrixError("400", "Invalid signature");
	}

	const [algorithm, hash] = computeHash(pdu);

	const expectedHash = (pdu as SignedJson<HashedEvent<T>>).hashes[algorithm];

	if (hash !== expectedHash) {
		throw new MatrixError("400", "Invalid hash");
	}
	return pdu as SignedJson<HashedEvent<T>>;
}
