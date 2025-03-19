import Elysia from "elysia";
import { Collection, WithId, type Db } from "mongodb";

import { type Key } from "./mongodb";
import { makeRequest } from "../makeRequest";
import { InferContext } from "@bogeychan/elysia-logger";

import { type V2KeyQueryBody } from "@hs/core/src/query";
import { getPublicKeyFromRemoteServer } from "../procedures/getPublicKeyFromServer";
import { Config } from "./config";

class KeysManager {
	private readonly keysCollection!: Collection<Key>;

	private config: Config | undefined;

	private constructor(db: Db) {
		this.keysCollection = db.collection<Key>("keys");
	}

	static createPlugin(db: Db) {
		const _manager = new KeysManager(db);

		return {
			query: _manager.query.bind(_manager),
		};
	}

	getLocalKeysForServer(
		serverName: string,
		keyId?: string,
		validUntil?: number,
	) {
		return this.keysCollection.find({
			server_name: serverName,
			...(keyId && { [`verify_keys.${keyId}`]: { $exists: true } }),
			...(validUntil && { valid_until_ts: { $lt: validUntil } }),
		});
	}

	getLocalKeysForServerList(
		serverName: string,
		keyId?: string,
		validUntil?: number,
	) {
		return this.getLocalKeysForServer(serverName, keyId, validUntil).toArray();
	}

	shouldRefetchKeys(keys: WithId<Key>[], validUntil: number) {
		return (
			keys.length === 0 ||
			keys.every(
				(key) => key._createdAt.getTime() + key.valid_until_ts / 2 < validUntil,
			)
		);
	}

	async getRemoteKeysForServer(serverName: string): Promise<Key> {
		return {} as unknown as Key;
	}

	async fetchAllkeysForServerName(
		serverName: string,
		keyId?: string,
		validUntil: number = Date.now(),
	): Promise<Key[]> {
		const keys = await this.getLocalKeysForServerList(serverName, keyId);

		if (!this.shouldRefetchKeys(keys, validUntil)) {
			return keys;
		}

		const remoteKey = await this.getRemoteKeysForServer(serverName);

		if (!this.shouldRefetchKeys([remoteKey], validUntil)) {
			return []; // expired even from remote server? likely for a custom minimum_valid_until_ts criteria. ok to return nothing.
		}

		if (keyId) {
			let foundOnNewKeys = false,
				foundOnOldKeys = false;

			const keys = Object.keys(remoteKey.verify_keys).reduce(
				(accum, key) => {
					if (key === keyId) {
						foundOnNewKeys = true;
						accum[key] = remoteKey.verify_keys[key];
					}

					return accum;
				},
				{} as Key["verify_keys"],
			);

			remoteKey.verify_keys = keys;

			const oldKeys = Object.keys(remoteKey.old_verify_keys).reduce(
				(accum, key) => {
					if (key === keyId) {
						foundOnOldKeys = true;
						accum[key] = remoteKey.old_verify_keys[key];
					}

					return accum;
				},
				{} as Key["old_verify_keys"],
			);

			remoteKey.old_verify_keys = oldKeys;

			if (!foundOnNewKeys && !foundOnOldKeys) {
				return [];
			}
		}

		return [remoteKey];
	}

	async query(request: V2KeyQueryBody) {
		const servers = Object.entries(request.server_keys);

		const response: { server_keys: Key[] } = { server_keys: [] };

		if (servers.length === 0) {
			return response;
		}

		for (const [serverName, _query] of servers) {
			const keys = Object.entries(_query);
			if (keys.length === 0) {
				// didn't ask for any specific keys
				const keys = await this.fetchAllkeysForServerName(serverName);
				response.server_keys = response.server_keys.concat(keys);
				continue;
			}

			for (const [
				keyId,
				{ minimum_valid_until_ts: minimumValidUntilTs },
			] of keys) {
				const keys = await this.fetchAllkeysForServerName(serverName, keyId, minimumValidUntilTs);
				response.server_keys = response.server_keys.concat(keys);
			}
		}

		return response;
	}
}

export const routerWithKeyManager = (db: Db) =>
	new Elysia().decorate("keys", KeysManager.createPlugin(db));

export type Context = InferContext<ReturnType<typeof routerWithKeyManager>>;
