import { createLogger } from '@rocket.chat/federation-core';
import {
	VerifierKey,
	encodeCanonicalJson,
	fromBase64ToBytes,
	isValidAlgorithm,
} from '@rocket.chat/federation-crypto';
import type { PersistentEventBase } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';
import { KeyService } from './key.service';

// low cost optimization in case of bad implementations
// ed25519 signatures in unpaddedbase64 are always 86 characters long (doing math here for future reference)
// 64 bytes in general, base64 => 21*3 = 63 + 1 padding "==" => 21 * 4 = 84 + 2 padding "==" (each char one byte) => 88 characters
// since in matrix it is unpadded base64, we remove the 2 padding chars => 86 characters
export const MAX_SIGNATURE_LENGTH_FOR_ED25519 = 86;

export type FederationRequest<Content extends object> =
	| {
			method: 'GET' | 'DELETE';
			uri: `/${string}`;
			origin: string;
			destination: string;
			signature: Record<string, Record<string, string>>;
	  }
	| {
			method: 'PUT' | 'POST' | 'DELETE';
			uri: `/${string}`;
			origin: string;
			destination: string;
			content: Content;
			signature: Record<string, Record<string, string>>;
	  };

@singleton()
export class SignatureVerificationService {
	constructor(private readonly keyService: KeyService) {}

	private readonly logger = createLogger('SignatureVerificationService');

	/**
	 * Implements part of SPEC: https://spec.matrix.org/v1.12/server-server-api/#validating-hashes-and-signatures-on-received-events
	 * The event structure should be verifier by the time this method is utilized, thus justifying the use of PersistentEventBase.
	 */
	async verifyEventSignature(
		event: PersistentEventBase,
		verifier?: VerifierKey,
	): Promise<void> {
		// SPEC: First the signature is checked. The event is redacted following the redaction algorithm
		const { redactedEvent, origin } = event;

		if (!origin) {
			throw new Error(
				`Invalid event sender, unable to find origin part from it ${event.sender}`,
			);
		}

		const { unsigned: _, ...toCheck } = redactedEvent;

		if (verifier) return this.verifySignature(toCheck, origin, verifier);

		const { key: requiredVerifier } =
			await this.keyService.getRequiredVerifierForEvent(event);

		return this.verifySignature(toCheck, origin, requiredVerifier);
	}

	async verifyRequestSignature(
		{
			authorizationHeader,
			method,
			body,
			uri,
		}: {
			authorizationHeader: string;
			method: string; // TODO: type better
			body: object | undefined;
			uri: string;
		},
		verifier: VerifierKey,
	) {
		// `X-Matrix origin="${origin}",destination="${destination}",key="${key}",sig="${signed}"`

		const regex = /\b(origin|destination|key|sig)="([^"]+)"/g;
		const {
			origin,
			destination,
			key,
			sig: signature,
			...rest
		} = Object.fromEntries(
			[...authorizationHeader.matchAll(regex)].map(
				([, key, value]) => [key, value] as const,
			),
		);

		if (Object.keys(rest).length) {
			// it should never happen since the regex should match all the parameters
			throw new Error('Invalid authorization header, unexpected parameters');
		}

		if ([origin, destination, key, signature].some((value) => !value)) {
			throw new Error('Invalid authorization header');
		}

		/*
			{
				"method": "POST",
				"uri": "/target",
				"origin": "origin.hs.example.com",
				"destination": "destination.hs.example.com",
				"content": <JSON-parsed request body>,
				"signatures": {
					"origin.hs.example.com": {
						"ed25519:key1": "ABCDEF..."
					}
				}
			}
		*/
		const toVerify = {
			method,
			uri,
			origin,
			destination,
			...(body && { content: body }),
			signatures: {
				[origin]: { [key]: signature },
			},
		};

		if (verifier) {
			return this.verifySignature(toVerify, origin, verifier);
		}

		const requiredVerifier = await this.keyService.getRequestVerifier(
			origin,
			key,
		);

		return this.verifySignature(toVerify, origin, requiredVerifier);
	}

	/**
	 * Implements SPEC: https://spec.matrix.org/v1.12/appendices/#checking-for-a-signature
	 */
	async verifySignature<
		T extends {
			signatures: Record<string, Record<string, string>>;
		},
	>(data: T, origin: string, verifier: VerifierKey) {
		// 1. Checks if the signatures member of the object contains an entry with the name of the entity. If the entry is missing then the check fails.
		const originSignature = data.signatures?.[origin];
		if (!originSignature) {
			throw new Error(`No signature found for origin ${origin}`);
		}

		// 2. Removes any signing key identifiers from the entry with algorithms it doesn’t understand. If there are no signing key identifiers left then the check fails.
		const signatureEntries = Object.entries(originSignature);
		const validSignatureEntries = new Map<string, string>();
		for (const [keyId, signature] of signatureEntries) {
			const parts = keyId.split(':');
			if (parts.length < 2) {
				this.logger.warn(`Invalid keyId format: ${keyId}`);
				continue; // we discard this entry but we do not fail yet
			}

			const algorithm = parts[0];

			if (!isValidAlgorithm(algorithm)) {
				this.logger.warn(`Unsupported algorithm: ${algorithm}`);
				continue; // we discard this entry but we do not fail yet
			}

			validSignatureEntries.set(keyId, signature);
		}
		if (validSignatureEntries.size === 0) {
			throw new Error(
				`No valid signature keys found for origin ${origin} with supported algorithms`,
			);
		}

		// 3. Looks up verification keys for the remaining signing key identifiers either from a local cache or by consulting a trusted key server. If it cannot find a verification key then the check fails.
		// one origin can sign with multiple keys - given how the spec AND the schema structures it.
		// we do NOT need all though, one is enough, one that we can fetch first
		if (!validSignatureEntries.has(verifier.id)) {
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
				`Invalid signature length for keyId ${verifier.id} from origin ${origin}, expected ${MAX_SIGNATURE_LENGTH_FOR_ED25519} got ${signatureEntry.length} characters`,
			);
		}

		const signatureBytes = fromBase64ToBytes(signatureEntry);
		if (signatureBytes.byteLength === 0) {
			throw new Error(
				`Failed to decode base64 signature for keyId ${verifier.id} from origin ${origin}`,
			);
		}

		// 5. Removes the signatures and unsigned members of the object.
		const { signatures, ...rest } = data;

		// 6. Encodes the remainder of the JSON object using the Canonical JSON encoding.
		const canonicalJson = encodeCanonicalJson(rest);

		// 7. Checks the signature bytes against the encoded object using the verification key. If this fails then the check fails. Otherwise the check succeeds.
		await verifier.verify(canonicalJson, signatureBytes);
	}
}
