import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "./config.service";
import { verifySignaturesFromRemote } from "../signJson";
import { ServerKey } from "@hs/core/src/server";
import { KeyRepository, ServerKeyDocument } from "../repositories/key.repository";
import { WithId } from "mongodb";
import { V2KeyQueryBody, V2KeyQueryResponse } from "@hs/core/src/query";
import { getKeyPair, SigningKey } from "../keys";
const logger = new Logger('KeyService');

@Injectable()
export class KeyService {
	private key: SigningKey | undefined;

	constructor(
		@Inject(ConfigService)
		private readonly configService: ConfigService,
		@Inject (KeyRepository) private readonly keyRepository: KeyRepository,
	) {
		this.configService.getSigningKey().then(key => { this.key = key[0]; })
	}
	
	private shouldRefetchKeys(
		serverName: string, // for logging
		keys: (ServerKey & { _createdAt: Date })[],
		validUntil?: number, // minimum_valid_until_ts
	) {
		if (keys.length === 0) {
			logger.log(`No keys found for ${serverName}, refetching keys`);
			return true;
		}
		
		return keys.every((key) => {
			if (validUntil) {
				if (key.valid_until_ts < validUntil) {
					logger.log(`Key for ${serverName} is expired, ${key.valid_until_ts} < ${validUntil}, refetching keys`);
					return true;
				}
				
				return false;
			}
			
			if ((key._createdAt.getTime() + key.valid_until_ts) / 2 < Date.now()) {
				logger.log(`Half life for key for ${serverName} is expired`);
				return true;
			}
		});
	}

	async validateKeySignature(serverName: string, serverkey: ServerKey) {
		const signatureKey = serverkey.signatures[serverName];
		if (!signatureKey) {
			throw new Error(`No signature key found for origin server ${serverName}`);
		}
		
		// validate the response first
		for (const keyId of Object.keys(signatureKey)) {
			const { key }= serverkey.verify_keys[keyId] ?? {};
			if (key)  {
				await verifySignaturesFromRemote(serverkey, serverName, async () => new Uint8Array(Buffer.from(key, 'base64')));
			}
		}
	}
	
	// TODO: support using separate notary server, for now we use the same server
	// since using the same server, we do not need to verify the signature, or rather we can not.
	// because this is the only way we get fetch the key of the server we are using.
	// TODO: once notary server is implemented, we need to verify the signature of the server we are using.
	// one could say this implementation is not the most ideal.
	// however, gotta use this path to get the tests to pass
	async fetchKeysRemote(serverName: string): Promise<ServerKey> {
		// this doesn't need to be signed request
		// notmal http is enough
		
		// 1. get the response from the server
		const response = await fetch(`https://${serverName}/_matrix/key/v2/server`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		});
		
		if (!response.ok) {
			throw new Error(`Failed to fetch keys from ${serverName}`);
		}
		
		const data: ServerKey = await response.json(); // intentional throw
		
		// weird but to be sure
		if (data.server_name !== serverName) {
			throw new Error(`Server name mismatch: ${data.server_name} !== ${serverName}`);
		}
		
		await this.validateKeySignature(serverName, data);
		
		return data;
	}
	
	async fetchKeys(serverName: string, { keyId, validUntil }: { keyId?: string, validUntil?: number }): Promise<WithId<ServerKeyDocument>[]> {
		// 1. check db
		const keysCursor = await this.keyRepository.findKeys(serverName, keyId, validUntil);
		
		const keys = await keysCursor.toArray(); // will return all keys for server_name nothing else was passed
		
		logger.log(`Found ${keys.length} keys in db for ${serverName}`);
		
		if (!keyId && !validUntil) {
			// no criteria was passed, return all keys
			return keys;
		}
		
		// if no criteria was passed, 
		if (!this.shouldRefetchKeys(serverName, keys, validUntil)) {
			logger.log(`Keys for ${serverName} are not expired, returning cached keys`);
			return keys;
		}
		
		logger.log(`Refetching keys for ${serverName}`);
		// 2. remote
		try {
			const remoteKeys = await this.fetchKeysRemote(serverName);
			
			logger.log(`Fetched keys for ${serverName}, JSON: ${JSON.stringify(remoteKeys)}`);
			
			// const _validUntil = validUntil ?? Date.now();
			
			// if (remoteKeys.valid_until_ts < _validUntil) {
			// 	// the key is expired
			// 	logger.log(`Keys for ${serverName} are expired ${remoteKeys.valid_until_ts} < ${_validUntil}, returning cached keys`);
			// 	return keys;
			// }
			
			logger.log(`Storing keys for ${serverName}`);

			// if not expired store, irrespective of the keyId as we may use this later to validate requests or events
			await this.keyRepository.storeKey(remoteKeys);

			if (keyId && !Object.keys(remoteKeys.verify_keys).includes(keyId)) {
				// was not asked about this key
				logger.log(`Was not asked about this key ${keyId}, returning empty array`);
				return [];
			}

			return [remoteKeys as WithId<ServerKeyDocument>];
		} catch (e) {
			logger.error(`Error fetching keys for ${serverName}: ${e}, returning cached keys`);
			return keys;
		}
	}
	
	async fetchKeysFromServer(notaryServerName: string, request: Record<string, Record<string, { validUntil: number }>>) {
		const foundkeys = [];
		const notaryQueryRequest = {} as V2KeyQueryBody['server_keys'];

		// FIXME: pointless
		for (const [serverName, filter] of Object.entries(request)) {
			for (const [keyId, { validUntil }] of Object.entries(filter)) {
				const keys = await this.keyRepository.findKeys(serverName, keyId, validUntil);
				const keysArray = await keys.toArray();

				if (keysArray.length === 0) {
					notaryQueryRequest[serverName] = { [keyId]: { minimum_valid_until_ts: validUntil } };
				} else {
					foundkeys.push(...keysArray);
				}
			}
		}

		if (Object.keys(notaryQueryRequest).length > 0) {
			// make sure we have the keys for the notary server
			const notaryKeys = await this.fetchKeys(notaryServerName, { keyId: undefined, validUntil: undefined });

			const notaryQueryResponse = await fetch(`https://${notaryServerName}/_matrix/key/v2/query`, {
				method: "POST",
				body: JSON.stringify(notaryQueryRequest),
			});

			if (!notaryQueryResponse.ok) {
				throw new Error(`Failed to fetch keys from notary server ${notaryServerName}`);
			}

			const notaryQueryResponseData: V2KeyQueryResponse = await notaryQueryResponse.json();

			
			for (const serverKey of notaryQueryResponseData.server_keys) {
				try {
					await this.validateKeySignature(notaryServerName, serverKey);
				} catch (e) {
					logger.error(`Error validating key signature for ${notaryServerName}: ${e}`);
					continue;
				}

				foundkeys.push(serverKey);
			}
			
			
		}
		
		await Promise.all(foundkeys.map(key => this.keyRepository.storeKey(key)));
		
		return foundkeys;
	}
	
	// only a verify_key can verify a s<>s request
	async getCurrentVerifyKey(serverName: string, keyId: string): Promise<string> {
		const key = await this.keyRepository.findKey(serverName, keyId, Date.now());
		
		if (key) {
			// decode first
			return atob(key.verify_keys[keyId].key);
		}
		
		// fetch from remote
		const remoteKeys = await this.fetchKeysRemote(serverName);

		// store too because why not
		void this.keyRepository.storeKey(remoteKeys);

		return atob(remoteKeys.verify_keys[keyId].key);
	}
}