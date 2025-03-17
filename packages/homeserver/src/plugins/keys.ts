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

	async getRemoteKeysForServer(serverName: string) {
	}

	shouldRefetchKeys(keys: WithId<Key>[], validUntil: number) {
		return (
			keys.length === 0 ||
			keys.every(
				(key) => key._createdAt.getTime() + key.valid_until_ts / 2 < validUntil,
			)
		);
	}

	async fetchAllkeysForServerName(
		serverName: string,
		validUntil: number = Date.now(),
	) {
		const keys = await this.getLocalKeysForServerList(serverName);

		if (!this.shouldRefetchKeys(keys, validUntil)) {
			return keys;
		}

		//
	}

	async query(request: V2KeyQueryBody) {
		const servers = Object.entries(request.server_keys);

		if (servers.length === 0) {
			return { server_keys: [] };
		}

		for (const [serverName, _query] of servers) {
			const keys = Object.entries(_query);
			if (keys.length === 0) {
				// didn't ask for any specific keys
				this.fetchAllkeysForServerName(serverName);
				continue;
			}

			for (const [
				keyId,
				{ minimum_valid_until_ts: minimumValidUntilTs },
			] of keys) {
				// fetch specific keys
			}
		}
	}
}

export const routerWithKeyManager = (db: Db) =>
	new Elysia().decorate("keys", KeysManager.createPlugin(db));

export type Context = InferContext<ReturnType<typeof routerWithKeyManager>>;
