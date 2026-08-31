import type { Pdu } from '@rocket.chat/federation-room';
import { PersistentEventFactory } from '@rocket.chat/federation-room';

import { type HashedEvent, computeHash } from './authentication';
import { MatrixError } from './errors';
import { logger } from './logger';
import { type SignedJson, getSignaturesFromRemote, verifyJsonSignature } from './signJson';

export async function checkSignAndHashes<T extends SignedJson<Pdu>>(
	pdu: HashedEvent<T>,
	origin: string,
	getPublicKeyFromServer: (origin: string, key: string) => Promise<string>,
	roomVersion: string,
) {
	const [signature] = await getSignaturesFromRemote(pdu, origin);
	const publicKey = await getPublicKeyFromServer(origin, `${signature.algorithm}:${signature.version}`);

	// the signature covers the redacted event, and the redaction algorithm is room version specific
	const { redactedEvent } = PersistentEventFactory.createFromRawEvent(pdu, roomVersion);

	if (
		!verifyJsonSignature(
			redactedEvent,
			origin,
			Uint8Array.from(atob(signature.signature), (c) => c.charCodeAt(0)),
			Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0)),
			signature.algorithm,
			signature.version,
		)
	) {
		throw new MatrixError('400', 'Invalid signature');
	}

	const {
		hashes: { sha256: expectedHash },
	} = pdu;

	const [, hash] = computeHash(pdu);

	if (hash !== expectedHash) {
		logger.error({ msg: 'Invalid hash', hash, expectedHash });
		throw new MatrixError('400', 'Invalid hash');
	}

	return pdu;
}
