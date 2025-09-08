import { createLogger } from '@hs/core';
import {
	encodeCanonicalJson,
	fromBase64ToBytes,
	isValidAlgorithm,
	loadEd25519VerifierFromPublicKey,
	VerifierKey,
} from '@hs/crypto';
import type { PersistentEventBase } from '@hs/room';

interface KeyData {
	server_name: string;
	verify_keys: {
		[keyId: string]: {
			key: string;
		};
	};
	old_verify_keys?: {
		[keyId: string]: {
			key: string;
			expired_ts: number;
		};
	};
}

// this is to not process the keyid string multiple times
type KeyId = {
	alg: string;
	ver: string;
	id: string;
};

// low cost optimization in case of bad implementations
// ed25519 signatures in unpaddedbase64 are always 86 characters long (doing math here for future reference)
// 64 bytes in general, base64 => 21*3 = 63 + 1 padding "==" => 21 * 4 = 84 + 2 padding "==" (each char one byte) => 88 characters
// since in matrix it is unpadded base64, we remove the 2 padding chars => 86 characters
export const MAX_SIGNATURE_LENGTH_FOR_ED25519 = 86;

export class SignatureVerificationService {
	private get logger() {
		return createLogger('SignatureVerificationService');
	}
	private cachedKeys = new Map<string, KeyData>();

	/**
	 * Implements SPEC: https://spec.matrix.org/v1.12/appendices/#checking-for-a-signature
	 * and part of https://spec.matrix.org/v1.12/server-server-api/#validating-hashes-and-signatures-on-received-events
	 * The event structure should be verifier by the time this method is utilized, thus justifying the use of PersistentEventBase.
	 */
	async verifyEventSignature(event: PersistentEventBase): Promise<void> {
		// SPEC: First the signature is checked. The event is redacted following the redaction algorithm
		const { redactedEvent, origin } = event;

		if (!origin) {
			throw new Error(
				`Invalid event sender, unable to find origin part from it ${event.sender}`,
			);
		}

		// 1. Checks if the signatures member of the object contains an entry with the name of the entity. If the entry is missing then the check fails.
		const originSignature = redactedEvent.signatures?.[origin];
		if (!originSignature) {
			throw new Error(`No signature found for origin ${origin}`);
		}

		// 2. Removes any signing key identifiers from the entry with algorithms it doesn’t understand. If there are no signing key identifiers left then the check fails.
		const signatureEntries = Object.entries(originSignature);
		const validSignatureEntries = [] as Array<[KeyId, string /* signature */]>;
		for (const [keyId, signature] of signatureEntries) {
			const parts = keyId.split(':');
			if (parts.length < 2) {
				this.logger.warn(`Invalid keyId format: ${keyId}`);
				continue; // we discard this entry but we do not fail yet
			}

			const algorithm = parts[0];
			const version = parts[1];

			if (!isValidAlgorithm(algorithm)) {
				this.logger.warn(`Unsupported algorithm: ${algorithm}`);
				continue; // we discard this entry but we do not fail yet
			}

			validSignatureEntries.push([
				{ alg: algorithm, ver: version, id: keyId },
				signature as string,
			]);
		}
		if (validSignatureEntries.length === 0) {
			throw new Error(
				`No valid signature keys found for origin ${origin} with supported algorithms`,
			);
		}

		// 3. Looks up verification keys for the remaining signing key identifiers either from a local cache or by consulting a trusted key server. If it cannot find a verification key then the check fails.
		// one origin can sign with multiple keys - given how the spec AND the schema structures it.
		// we do NOT need all though, one is enough, one that we can fetch first
		let verifier: VerifierKey | undefined;
		for (const [keyId] of validSignatureEntries) {
			try {
				verifier = await this.getSignatureVerifierForServer(origin, keyId);
				break; // found one, should be enough
			} catch (error) {
				this.logger.warn(
					`Failed to get verifier for ${origin} with keyId ${keyId.id}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		if (!verifier) {
			throw new Error(
				`No valid verification key found for origin ${origin} with supported algorithms`,
			);
		}

		// 4. Decodes the base64 encoded signature bytes. If base64 decoding fails then the check fails.
		// we needed to know which key to use to know which signature to decode.
		const signatureEntry: string = originSignature[verifier.id];
		if (!signatureEntry) {
			throw new Error(
				`No signature entry found for keyId ${verifier.id} from origin ${origin}`,
			);
		}

		if (signatureEntry.length !== MAX_SIGNATURE_LENGTH_FOR_ED25519) {
			throw new Error(
				`Invalid signature length for keyId ${verifier.id} from origin ${origin}, expected 86 got ${signatureEntry.length} characters`,
			);
		}

		let signatureBytes: Uint8Array;
		try {
			signatureBytes = fromBase64ToBytes(signatureEntry);
		} catch (error) {
			throw new Error(
				`Failed to decode base64 signature for keyId ${verifier.id} from origin ${origin}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// 5. Removes the signatures and unsigned members of the object.
		const { signatures, unsigned, ...rest } = redactedEvent;

		// 6. Encodes the remainder of the JSON object using the Canonical JSON encoding.
		const canonicalJson = encodeCanonicalJson(rest);

		// 7. Checks the signature bytes against the encoded object using the verification key. If this fails then the check fails. Otherwise the check succeeds.
		await verifier.verify(canonicalJson, signatureBytes);
	}

	// throws if no key
	async getSignatureVerifierForServer(
		serverName: string,
		keyId: KeyId,
	): Promise<VerifierKey> {
		const keyData = await this.getOrFetchPublicKey(serverName, keyId.id);
		if (!keyData || !keyData.verify_keys[keyId.id]) {
			throw new Error(`Public key not found for ${serverName}:${keyId.id}`);
		}

		const publicKey = keyData.verify_keys[keyId.id].key;

		const verifier = await loadEd25519VerifierFromPublicKey(
			fromBase64ToBytes(publicKey),
			keyId.ver,
		);

		return verifier;
	}

	/**
	 * Get public key from cache or fetch it from the server
	 */
	private async getOrFetchPublicKey(
		serverName: string,
		keyId: string,
	): Promise<KeyData | null | undefined> {
		const cacheKey = `${serverName}:${keyId}`;

		if (this.cachedKeys.has(cacheKey)) {
			return this.cachedKeys.get(cacheKey);
		}

		try {
			const response = await fetch(
				`https://${serverName}/_matrix/key/v2/server`,
			);

			if (!response.ok) {
				this.logger.error(
					`Failed to fetch keys from ${serverName}: ${response.status}`,
				);
				return null;
			}

			const keyData = (await response.json()) as KeyData;

			this.cachedKeys.set(cacheKey, keyData);

			return keyData;
		} catch (error: any) {
			this.logger.error(
				`Error fetching public key: ${error.message}`,
				error.stack,
			);
			return null;
		}
	}
}
