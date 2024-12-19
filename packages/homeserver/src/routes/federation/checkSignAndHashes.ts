import { computeHash, type HashedEvent } from "../../authentication";
import type { EventBase } from "@hs/core/src/events/eventBase";
import {
	getSignaturesFromRemote,
	verifyJsonSignature,
	type SignedJson,
} from "../../signJson";
import { pruneEventDict } from "../../pruneEventDict";
import { MatrixError } from "../../errors";

export async function checkSignAndHashes(
	pdu: SignedJson<HashedEvent<EventBase>>,
	origin: string,
	getPublicKeyFromServer: (origin: string, key: string) => Promise<string>,
) {
	const { hashes, ...rest } = pdu;

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

	const expectedHash = pdu.hashes[algorithm];

	if (hash !== expectedHash) {
		throw new MatrixError("400", "Invalid hash");
	}

	return true;
}
