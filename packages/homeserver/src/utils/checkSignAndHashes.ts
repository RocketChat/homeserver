import type { EventBase } from '@hs/core/src/events/eventBase';
import { computeHash, type HashedEvent } from '@hs/core';
import { MatrixError } from '../errors';
import { pruneEventDict } from '@hs/core';
import {
	getSignaturesFromRemote,
	type SignedJson,
	verifyJsonSignature,
} from '@hs/federation-sdk';
import { createLogger } from '@hs/core';

const logger = createLogger('checkSignAndHashes');

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
		logger.error('Invalid hash', hash, expectedHash);
		throw new MatrixError('400', 'Invalid hash');
	}

	return pdu;
}
