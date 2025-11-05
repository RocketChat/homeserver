import {
	type KeyV2ServerResponse,
	type ServerKey,
	fetch as coreFetch,
} from '@rocket.chat/federation-core';
import {
	type Signer,
	VerifierKey,
	fromBase64ToBytes,
	isValidAlgorithm,
	loadEd25519VerifierFromPublicKey,
	signJson,
} from '@rocket.chat/federation-crypto';
import { PersistentEventBase } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';
import { KeyRepository } from '../repositories/key.repository';
import { getHomeserverFinalAddress } from '../server-discovery/discovery';
import { createLogger } from '../utils/logger';
import { ConfigService } from './config.service';

type QueryCriteria = {
	// If not supplied, the current time as determined by the notary server is used.
	minimum_valid_until_ts?: number;
};

type QueryRequestBody = {
	server_keys: Record<
		string /* serverName */,
		Record<string /* keyId */, QueryCriteria>
	>;
};

function isKeyV2ServerResponse(obj: unknown): obj is KeyV2ServerResponse {
	if (
		typeof obj === 'object' &&
		obj !== null &&
		'signatures' in obj &&
		'server_name' in obj &&
		'verify_keys' in obj &&
		'valid_until_ts' in obj &&
		'old_verify_keys' in obj
	) {
		return true;
	}
	return false;
}

// to help with caching and cehcking if a key can still be used
// check isVerifierAllowedToCheckEvent
export type OldVerifierKey = {
	key: VerifierKey;
	expiredAt: Date;
};

@singleton()
export class KeyService {
	private signer: Signer | undefined;

	private logger = createLogger('KeyService');
	constructor(
		private readonly configService: ConfigService,
		private readonly keyRepository: KeyRepository,
	) {
		this.configService.getSigningKey().then((signer) => {
			this.signer = signer;
		});
	}

	public isVerifierAllowedToCheckEvent(
		event: PersistentEventBase,
		verifier: OldVerifierKey,
	): boolean {
		if (event.originServerTs > verifier.expiredAt.getTime()) {
			this.logger.warn(
				`Key ${verifier.key.id} expired at ${verifier.expiredAt.toISOString()} cannot be used to verify event from ${event.origin} with originServerTs ${new Date(event.originServerTs).toISOString()}`,
			);
			return false;
		}

		return true;
	}

	private shouldRefetchKey(key: ServerKey, validUntil?: number) {
		const { serverName } = key;

		if (validUntil) {
			if (key.expiresAt.getTime() < validUntil) {
				this.logger.warn(
					`Key for ${serverName} is expired, ${key.expiresAt} < ${validUntil}, refetching keys`,
				);
				return true;
			}

			return false;
		}

		// SPEC: Intermediate notary servers should cache a response for half of its lifetime to avoid serving a stale response.
		// this could be part of an aggregation, however, the key data stored aren't big enough to justify the complexity right now.
		if ((key._updatedAt.getTime() + key.expiresAt.getTime()) / 2 < Date.now()) {
			this.logger.warn(`Half life for key for ${serverName} is expired`);
			return true;
		}

		return false;
	}

	async fetchAndSaveKeysFromRemoteServerRaw(
		serverName: string,
	): Promise<KeyV2ServerResponse> {
		const [address, hostHeaders] = await getHomeserverFinalAddress(
			serverName,
			this.logger,
		);

		// TODO: move this to federation service??
		const keyV2ServerUrl = new URL(`${address}/_matrix/key/v2/server`);

		const response = await coreFetch(keyV2ServerUrl, {
			headers: hostHeaders,
			method: 'GET',
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			this.logger.error(
				`Failed to fetch keys from remote server ${serverName}: ${response.status} ${response.text()}`,
			);
			throw new Error('Failed to fetch keys');
		}

		const data = await response.json();

		if (!isKeyV2ServerResponse(data)) {
			this.logger.error(
				{ data },
				`Invalid key response from remote server ${serverName}`,
			);
			throw new Error('Invalid key response');
		}

		void this.storeKeysFromResponse(data);

		return data;
	}

	private parseKeyId(keyId: string) {
		// keyId should be in the format <algorithm>:<version>
		const [algorithm, version] = keyId.split(':');
		if (!algorithm || !version) {
			throw new Error('Invalid keyId format');
		}

		if (!isValidAlgorithm(algorithm)) {
			throw new Error('Invalid algorithm in keyId');
		}

		return { algorithm, version };
	}

	private async storeKeysFromResponse(
		response: KeyV2ServerResponse,
	): Promise<void> {
		const keys: ServerKey[] = [];

		for (const [keyId, keyInfo] of Object.entries(response.verify_keys)) {
			const { version } = this.parseKeyId(keyId);

			const verifier = await loadEd25519VerifierFromPublicKey(
				fromBase64ToBytes(keyInfo.key),
				version,
			);

			keys.push({
				serverName: response.server_name,
				keyId: verifier.id,
				key: keyInfo.key,
				pem: verifier.getPublicKeyPem(),

				_createdAt: new Date(),
				_updatedAt: new Date(),
				expiresAt: new Date(response.valid_until_ts),
			});
		}

		for (const [keyId, keyInfo] of Object.entries(response.old_verify_keys)) {
			const { version } = this.parseKeyId(keyId);

			const verifier = await loadEd25519VerifierFromPublicKey(
				fromBase64ToBytes(keyInfo.key),
				version,
			);

			keys.push({
				serverName: response.server_name,
				keyId: verifier.id,
				key: keyInfo.key,
				pem: verifier.getPublicKeyPem(),

				_createdAt: new Date(),
				_updatedAt: new Date(),
				expiresAt: new Date(keyInfo.expired_ts),
			});
		}

		await Promise.all(
			keys.map((key) => this.keyRepository.insertOrUpdateKey(key)),
		);
	}

	// multiple keys -> single repnse
	async convertToKeyV2Response(
		serverKeys: ServerKey[],
		minimumValidUntil = Date.now(),
	): Promise<KeyV2ServerResponse> {
		if (!this.signer) {
			// need this to sign the response json, no point in calculating anythingg if this isn't ready
			throw new Error('Signing key not configured');
		}
		const verifyKeys: KeyV2ServerResponse['verify_keys'] = {};

		const oldVerifyKeys: KeyV2ServerResponse['old_verify_keys'] = {};

		let validUntil = 0;

		const serverName = serverKeys[0]?.serverName;

		for (const key of serverKeys) {
			if (key.serverName !== serverName) {
				throw new Error('All keys must be from the same server');
			}

			if (key.expiresAt.getTime() > validUntil) {
				validUntil = key.expiresAt.getTime();
			}

			// if expired, move to old keys
			if (key.expiresAt.getTime() < minimumValidUntil) {
				oldVerifyKeys[key.keyId] = {
					expired_ts: key.expiresAt.getTime(),
					key: key.key,
				};
			} else {
				verifyKeys[key.keyId] = {
					key: key.key,
				};
			}
		}

		const response = {
			server_name: serverName,
			verify_keys: verifyKeys,
			old_verify_keys: oldVerifyKeys,
			valid_until_ts: validUntil,
		};

		const signature = await signJson(response, this.signer);

		return {
			...response,
			signatures: {
				[this.configService.serverName]: {
					[this.signer.id]: signature,
				},
			},
		};
	}

	// this shouldn't be here, however, to copy the controller level logic from homeserver router to rocket.chat would be a pain to keep up to date if changes are needed. for now, keeping here.
	async handleQuery({ server_keys: serverKeys }: QueryRequestBody) {
		if (!this.signer) {
			// need this to sign the response json, no point in calculating anythingg if this isn't ready
			throw new Error('Signing key not configured');
		}

		const serverKeysResponse = [] as KeyV2ServerResponse[];

		const localKeysPerServer: Map<string, ServerKey[]> = new Map();

		for (const [serverName, query] of Object.entries(serverKeys)) {
			const keysAsked = Object.keys(query);

			this.logger.debug({ serverName, query, keyIds: keysAsked }, 'keys asked');

			if (keysAsked.length === 0) {
				const keys = await this.keyRepository
					.findByServerName(serverName)
					.toArray();

				if (!keys.length) {
					this.logger.debug({ serverName, keys }, 'no cached keys found');
					// no cache, fetch from remote and stpre
					try {
						const remoteKeys =
							await this.fetchAndSaveKeysFromRemoteServerRaw(serverName);
						serverKeysResponse.push(remoteKeys);

						this.logger.debug(
							{
								response: remoteKeys,
								serverName,
							},
							'keys from remote',
						);
					} catch (error) {
						// SPEC: If the server fails to respond to this request, intermediate notary servers should continue to return the last response they received from the server so that the signatures of old events can still be checked.
						this.logger.warn(
							{ error },
							`Failed to fetch keys from remote server ${serverName}, continuing with cached keys if any`,
						);

						// no cached keys in this instance, we return empty list in that case.
					}
					continue;
				}

				// check if any of the cached keys need refetching
				if (keys.every((key) => this.shouldRefetchKey(key))) {
					try {
						const remoteKeys =
							await this.fetchAndSaveKeysFromRemoteServerRaw(serverName);
						serverKeysResponse.push(remoteKeys);

						this.logger.debug(
							{
								response: remoteKeys,
								serverName,
							},
							'keys from remote after refetch',
						);
					} catch (error) {
						// SPEC: If the server fails to respond to this request, intermediate notary servers should continue to return the last response they received from the server so that the signatures of old events can still be checked.
						this.logger.warn(
							{ error },
							`Failed to fetch keys from remote server ${serverName}, continuing with cached keys if any`,
						);

						localKeysPerServer.set(serverName, keys);
					}

					continue;
				}

				this.logger.debug({ serverName, keys }, 'using cached keys');

				localKeysPerServer.set(serverName, keys);

				continue;
			}

			if (
				!keysAsked.some((keyId) =>
					isValidAlgorithm(keyId.split(':').shift() ?? ''),
				)
			) {
				throw new Error('Invalid keyId format when querying for keys');
			}

			// intentionally querying for all keys from db, since asked, if we didn't find one, should trigger a refetch
			const keysForQuery = await this.keyRepository
				.findAllByServerNameAndKeyIds(serverName, keysAsked)
				.toArray();

			this.logger.debug(
				{ serverName, query, keysForQuery },
				'keys found for query',
			);

			if (
				keysForQuery.length === 0 ||
				keysForQuery.every((key) =>
					this.shouldRefetchKey(key, query[key.keyId]?.minimum_valid_until_ts),
				)
			) {
				this.logger.debug('need to refetch keys');
				// no valid cache, fetch from remote and stpre
				try {
					const remoteKeys =
						await this.fetchAndSaveKeysFromRemoteServerRaw(serverName);
					// TODO: apply actual filter
					serverKeysResponse.push(remoteKeys);

					this.logger.debug(
						{
							response: remoteKeys,
							serverName,
						},
						'keys from remote after refetch for query',
					);
				} catch (error) {
					// SPEC: If the server fails to respond to this request, intermediate notary servers should continue to return the last response they received from the server so that the signatures of old events can still be checked.
					this.logger.warn(
						{ error },
						`Failed to fetch keys from remote server ${serverName}, continuing with cached keys if any`,
					);

					if (keysForQuery.length !== 0) {
						localKeysPerServer.set(serverName, keysForQuery);
					}
				}

				continue;
			}

			localKeysPerServer.set(serverName, keysForQuery);
		}

		const keys = await Promise.all([
			// convert and sign
			...localKeysPerServer
				.values()
				.map(this.convertToKeyV2Response.bind(this)),
			// sign with our keys
			...serverKeysResponse.map(async (key): Promise<KeyV2ServerResponse> => {
				const { signatures, ...rest } = key;
				const signature = await signJson(rest, this.signer!);

				return {
					...rest,
					signatures: {
						...signatures,
						[this.configService.serverName]: {
							[this.signer!.id]: signature,
						},
					},
				};
			}),
		]);

		return {
			server_keys: keys,
		};
	}

	// use only for request signature verification
	// does nto include expired keys
	async getRequestVerifier(
		serverName: string,
		keyId: string,
	): Promise<VerifierKey> {
		const { version } = this.parseKeyId(keyId);

		const localKey = await this.keyRepository.findByServerNameAndKeyId(
			serverName,
			keyId,
			new Date(),
		);

		if (localKey && !this.shouldRefetchKey(localKey)) {
			const verifier = await loadEd25519VerifierFromPublicKey(
				fromBase64ToBytes(localKey.key), // TODO: use saved pem here
				version,
			);

			return verifier;
		}

		// either no key saved or needs a refetch
		const remoteKeys =
			await this.fetchAndSaveKeysFromRemoteServerRaw(serverName);
		if (!remoteKeys.verify_keys[keyId]) {
			throw new Error(`Key ${keyId} not found on server ${serverName}`);
		}

		if (remoteKeys.valid_until_ts < Date.now()) {
			throw new Error(`Key ${keyId} from server ${serverName} is expired`);
		}

		const verifier = await loadEd25519VerifierFromPublicKey(
			fromBase64ToBytes(remoteKeys.verify_keys[keyId].key),
			version,
		);

		return verifier;
	}

	// use for event signature verification
	// includes expired keys
	async getEventVerifier(
		serverName: string,
		keyId: string,
		expiredAt?: Date,
	): Promise<OldVerifierKey> {
		const { version } = this.parseKeyId(keyId);
		const localKey = await this.keyRepository.findByServerNameAndKeyId(
			serverName,
			keyId,
			expiredAt,
		);

		if (localKey) {
			this.logger.debug(
				{ serverName, keyId, expiredAt },
				'Found local key for event verification',
			);
			// we won't check for half life here, since this is for event signature verification, we need to use whatever is available andd is valid
			const verifier = await loadEd25519VerifierFromPublicKey(
				fromBase64ToBytes(localKey.key),
				version,
			);

			return {
				key: verifier,
				expiredAt: localKey.expiresAt,
			};
		}

		const expectedExpiry = expiredAt?.getTime() ?? Date.now();

		this.logger.debug(
			{ serverName, keyId },
			`expected expiry: ${new Date(expectedExpiry).toISOString()}`,
		);

		const remoteKeys =
			await this.fetchAndSaveKeysFromRemoteServerRaw(serverName);

		this.logger.debug({ response: remoteKeys }, 'Remote keys fetched');

		if (remoteKeys.verify_keys[keyId]) {
			// expired, against the required expiry time
			if (remoteKeys.valid_until_ts < expectedExpiry) {
				throw new Error(`Key ${keyId} from server ${serverName} is expired`);
			}

			const expiredAt_ = new Date(remoteKeys.valid_until_ts);
			const publicKey = remoteKeys.verify_keys[keyId].key;
			const verifier = await loadEd25519VerifierFromPublicKey(
				fromBase64ToBytes(publicKey),
				version,
			);

			return {
				key: verifier,
				expiredAt: expiredAt_,
			};
		}

		// either are valid for event signing
		const publicKey = remoteKeys.old_verify_keys[keyId];
		if (!publicKey) {
			throw new Error(`Key ${keyId} not found on server ${serverName}`);
		}

		if (publicKey.expired_ts < expectedExpiry) {
			throw new Error(`Key ${keyId} from server ${serverName} is expired`);
		}

		const verifier = await loadEd25519VerifierFromPublicKey(
			fromBase64ToBytes(publicKey.key),
			version,
		);

		return {
			key: verifier,
			expiredAt: new Date(publicKey.expired_ts),
		};
	}

	async getRequiredVerifierForEvent(
		event: PersistentEventBase,
	): Promise<OldVerifierKey> {
		this.logger.debug(
			{ eventId: event.eventId },
			'Getting required verifier for event',
		);

		const signaturesFromOrigin = event.event.signatures[event.origin];

		if (!signaturesFromOrigin) {
			throw new Error(`No signatures from origin ${event.origin}`);
		}

		// can be signed by multiple keys
		for (const keyId of Object.keys(signaturesFromOrigin)) {
			try {
				const verifier = await this.getEventVerifier(
					event.origin,
					keyId,
					new Date(event.originServerTs),
				);

				this.logger.debug(
					{
						eventId: event.eventId,
						keyId,
						origin: event.origin,
					},
					'Found verifier',
				);

				return verifier;
			} catch (error) {
				// if couldn't find, it's ok, try next
				this.logger.warn(
					{ error, keyId, origin: event.origin },
					`Failed to get verifier for event from ${event.origin} with keyId ${keyId}`,
				);
			}
		}

		throw new Error(
			`No valid signature keys found for origin ${event.origin} with supported algorithms`,
		);
	}
}
