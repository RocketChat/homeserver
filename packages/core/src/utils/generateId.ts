import crypto from 'node:crypto';

import { encodeCanonicalJson } from '@rocket.chat/federation-crypto';
import type { EventID, Pdu } from '@rocket.chat/federation-room';

import type { EventBase } from '@rocket.chat/federation-core';

import { toUnpaddedBase64 } from './binaryData';
import { pruneEventDict } from './pruneEventDict';

export function generateId<T extends Pdu | EventBase>(content: T): EventID {
	// remove the fields that are not part of the hash
	const { unsigned, signatures, ...toHash } = pruneEventDict(content);

	return `\$${toUnpaddedBase64(crypto.createHash('sha256').update(encodeCanonicalJson(toHash)).digest(), { urlSafe: true })}` as EventID;
}
