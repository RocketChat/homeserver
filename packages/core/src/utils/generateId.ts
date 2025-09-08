import crypto from 'node:crypto';
import { toUnpaddedBase64 } from './binaryData';
import { pruneEventDict } from './pruneEventDict';
import { encodeCanonicalJson } from './signJson';

export function generateId<T extends object>(content: T): string {
	// remove the fields that are not part of the hash
	const { unsigned, signatures, ...toHash } = pruneEventDict(content as any);

	return `\$${toUnpaddedBase64(
		crypto.createHash('sha256').update(encodeCanonicalJson(toHash)).digest(),
		{ urlSafe: true },
	)}`;
}
