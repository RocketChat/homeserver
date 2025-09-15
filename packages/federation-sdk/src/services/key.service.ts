import { singleton } from 'tsyringe';
import { ConfigService } from './config.service';
import { KeyRepository } from '../repositories/key.repository';
import {
	fromBase64ToBytes,
	isValidAlgorithm,
	loadEd25519VerifierFromPublicKey,
	signJson,
	type Signer,
} from '@hs/crypto';
import {
	fetch as _myFetch,
	type KeyV2ServerResponse,
	type ServerKey,
} from '@hs/core';
import { createLogger } from '../utils/logger';
import { getHomeserverFinalAddress } from '../server-discovery/discovery';
import { ConnectionCheckOutFailedEvent } from 'mongodb';

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

	private shouldRefetchKey(
		localKey: ServerKey,
		keyId: string,
		validUntil?: number,
	) {
		const key = localKey.keys[keyId];

		const { serverName } = localKey;

		if (validUntil) {
			if (key.expiresAt < validUntil) {
				this.logger.warn(
					`Key for ${serverName} is expired, ${key.expiresAt} < ${validUntil}, refetching keys`,
				);
				return true;
			}

			return false;
		}

		// SPEC: Intermediate notary servers should cache a response for half of its lifetime to avoid serving a stale response.
		// this could be part of an aggregation, however, the key data stored aren't big enough to justify the complexity right now.
		if ((key._updatedAt.getTime() + key.expiresAt) / 2 < Date.now()) {
			this.logger.warn(`Half life for key for ${serverName} is expired`);
			return true;
		}
	}

	async fetchKeysFromRemoteServerRaw(
		serverName: string,
	): Promise<KeyV2ServerResponse> {
		// FIXME:
		// const [address, hostHeaders] = await getHomeserverFinalAddress(
		// 	serverName,
		// 	this.logger,
		// );

		// TODO: move this to federation service??
		// const keyV2ServerUrl = new URL(`${address}/_matrix/key/v2/server`);

		const response = await fetch(
			`https://${serverName}/_matrix/key/v2/server`,
			{
				// headers: hostHeaders,
				method: 'GET',
			},
		);

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
		const existingKey = await this.keyRepository.findByServerName(
			response.server_name,
		);
		const keys: ServerKey = {
			serverName: response.server_name,
			keys: existingKey ? existingKey.keys : {},
		};

		for (const [keyId, keyInfo] of Object.entries(response.verify_keys)) {
			const { version } = this.parseKeyId(keyId);

			const verifier = await loadEd25519VerifierFromPublicKey(
				fromBase64ToBytes(keyInfo.key),
				version,
			);

			keys.keys[verifier.id] = {
				key: keyInfo.key,
				pem: verifier.getPublicKeyPem(),

				_createdAt: existingKey?.keys?.[verifier.id]?._createdAt ?? new Date(),
				_updatedAt: new Date(),
				expiresAt: response.valid_until_ts,
			};
		}

		for (const [keyId, keyInfo] of Object.entries(response.old_verify_keys)) {
			const { version } = this.parseKeyId(keyId);

			const verifier = await loadEd25519VerifierFromPublicKey(
				fromBase64ToBytes(keyInfo.key),
				version,
			);

			keys.keys[verifier.id] = {
				key: keyInfo.key,
				pem: verifier.getPublicKeyPem(),

				_createdAt: existingKey?.keys?.[verifier.id]?._createdAt ?? new Date(),
				_updatedAt: new Date(),
				expiresAt: keyInfo.expired_ts,
			};
		}

		await this.keyRepository.storeKeys(keys);
	}

	async convertToKeyV2Response(
		serverKey: ServerKey,
		minimumValidUntil = Date.now(),
	): Promise<KeyV2ServerResponse> {
		if (!this.signer) {
			// need this to sign the response json, no point in calculating anythingg if this isn't ready
			throw new Error('Signing key not configured');
		}
		const verifyKeys: KeyV2ServerResponse['verify_keys'] = {};

		const oldVerifyKeys: KeyV2ServerResponse['old_verify_keys'] = {};

		let validUntil = 0;

		for (const [keyId, keyInfo] of Object.entries(serverKey.keys)) {
			if (keyInfo.expiresAt > validUntil) {
				validUntil = keyInfo.expiresAt;
			}

			// if expired, move to old keys
			if (keyInfo.expiresAt < minimumValidUntil) {
				oldVerifyKeys[keyId] = {
					expired_ts: keyInfo.expiresAt,
					key: keyInfo.key,
				};
			} else {
				verifyKeys[keyId] = {
					key: keyInfo.key,
				};
			}
		}

		const response = {
			server_name: serverKey.serverName,
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

		const localKeys = [] as ServerKey[];

		for (const [serverName, query] of Object.entries(serverKeys)) {
			const keysAsked = Object.keys(query);

			this.logger.debug({ serverName, query, keyIds: keysAsked }, 'keys asked');

			if (keysAsked.length === 0) {
				const keys = await this.keyRepository.findByServerName(serverName);

				if (!keys) {
					this.logger.debug({ serverName, keys }, 'no cached keys found');
					// no cache, fetch from remote and stpre
					try {
						const remoteKeys =
							await this.fetchKeysFromRemoteServerRaw(serverName);
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
				if (
					Object.keys(keys.keys).every((keyId) =>
						this.shouldRefetchKey(keys, keyId),
					)
				) {
					try {
						const remoteKeys =
							await this.fetchKeysFromRemoteServerRaw(serverName);
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

						localKeys.push(keys);
					}

					continue;
				}

				this.logger.debug({ serverName, keys }, 'using cached keys');

				localKeys.push(keys);

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
			const keysForQuery =
				await this.keyRepository.findAllByServerNameAndKeyIds(
					serverName,
					keysAsked,
				);

			this.logger.debug(
				{ serverName, query, keysForQuery },
				'keys found for query',
			);

			if (
				!keysForQuery ||
				keysAsked.every((keyId) =>
					this.shouldRefetchKey(
						keysForQuery,
						keyId,
						query[keyId]?.minimum_valid_until_ts,
					),
				)
			) {
				// no valid cache, fetch from remote and stpre
				try {
					const remoteKeys =
						await this.fetchKeysFromRemoteServerRaw(serverName);
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

					if (keysForQuery) {
						localKeys.push(keysForQuery);
					}
				}

				continue;
			}

			localKeys.push(keysForQuery);
		}

		const keys = await Promise.all([
			// convert and sign
			...localKeys.map(this.convertToKeyV2Response.bind(this)),
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
}
