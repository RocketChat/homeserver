import type { EventBase } from '@hs/core/src/events/eventBase';
import { computeHash, type HashedEvent } from '../authentication';
import { MatrixError } from '../errors';
import { pruneEventDict } from '../pruneEventDict';
import {
	getSignaturesFromRemote,
	type SignedJson,
	verifyJsonSignature,
} from '../signJson';

export async function checkSignAndHashes<T extends SignedJson<EventBase>>(
	pdu: HashedEvent<T>,
	origin: string,
	getPublicKeyFromServer: (origin: string, key: string) => Promise<string>,
) {
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
		throw new MatrixError('400', 'Invalid signature');
	}

	const [algorithm, hash] = computeHash(pdu);

	const expectedHash = pdu.hashes[algorithm];

	if (hash !== expectedHash) {
		console.error('Invalid hash', hash, expectedHash);
		throw new MatrixError('400', 'Invalid hash');
	}

	return pdu;
}
