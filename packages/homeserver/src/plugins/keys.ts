import Elysia from "elysia";
import { Collection, FindOptions, WithoutId, type Db } from "mongodb";

import { InferContext } from "@bogeychan/elysia-logger";
import { makeRequest } from "../makeRequest";
import { type Key } from "./mongodb";

import { type V2KeyQueryBody } from "@hs/core/src/query";
import { getSignaturesFromRemote, signJson } from "../signJson";
import { Config } from "./config";

type OnlyKey = Omit<WithoutId<Key>, "_createdAt">;

class KeysManager {
	private readonly keysCollection!: Collection<Key>;

	private config!: Config;

	private constructor(db: Db, config: Config) {
		this.keysCollection = db.collection<Key>("keys");
		this.config = config;
	}

	static createPlugin(db: Db, config: Config) {
		const _manager = new KeysManager(db, config);

		return {
			query: _manager.query.bind(_manager),
		};
	}

	storeKeys(key: Key) {
		return this.keysCollection.insertOne({ ...key, _createdAt: new Date() });
	}

	getLocalKeysForServer(
		serverName: string,
		keyId?: string,
		validUntil?: number,
		opts?: FindOptions<Key>,
	) {
		return this.keysCollection.find(
			{
				server_name: serverName,
				...(keyId && { [`verify_keys.${keyId}`]: { $exists: true } }),
				...(validUntil && { valid_until_ts: { $lt: validUntil } }),
			},
			opts,
		);
	}

	getLocalKeysForServerList(
		serverName: string,
		keyId?: string,
		validUntil?: number,
		opts?: FindOptions<Key>,
	) {
		return this.getLocalKeysForServer(
			serverName,
			keyId,
			validUntil,
			opts,
		).toArray();
	}

	shouldRefetchKeys(
		keys: (Omit<OnlyKey, "_createdAt"> & { _createdAt?: Date })[],
		validUntil?: number,
	) {
		return (
			keys.length === 0 ||
			keys.every((key) =>
				validUntil
					? key.valid_until_ts < validUntil
					: ((key._createdAt?.getTime() || Date.now()) + key.valid_until_ts) /
					2 <
					Date.now(),
			)
		);
	}

	async getRemoteKeysForServer(serverName: string): Promise<OnlyKey> {
		const response = await makeRequest({
			signingName: this.config.name,
			method: "GET",
			domain: serverName,
			uri: "/_matrix/key/v2/server",
		});

		// TODO(deb): check what this does;
		const [signature] = await getSignaturesFromRemote(response, serverName);

		if (!signature) {
			throw new Error("no signature found");
		}

		return response;
	}

	async fetchAllkeysForServerName(
		serverName: string,
		keyId?: string,
		validUntil: number = Date.now(),
	): Promise<Key[]> {
		const keys = await this.getLocalKeysForServerList(serverName, keyId);

		console.log({ msg: "cached keys", serverName, value: keys });

		if (!this.shouldRefetchKeys(keys, validUntil)) {
			console.log({ msg: "cache validated", serverName, value: keys });
			return keys;
		}

		console.log({ msg: "cache invalidated", serverName });

		const remoteKey = await (async () => {
			try {
				console.log({ msg: 'fetching from remote', serverName });
				const remoteKey = await this.getRemoteKeysForServer(serverName);
				return remoteKey;
			} catch (err) {
				console.log({
					msg: "failed to fetch remote keys",
					serverName,
					value: err,
				});
			}
		})();

		if (remoteKey) {
			console.log({ msg: "remote key", serverName, value: remoteKey });

			void this.storeKeys(remoteKey as Key);
		} else {
			return keys;
		}

		// if (!this.shouldRefetchKeys([remoteKey], validUntil)) {
		// 	return []; // expired even from remote server? likely for a custom minimum_valid_until_ts criteria. ok to return nothing.
		// }

		if (keyId) {
			let found = false;

			const keys = Object.keys(remoteKey.verify_keys).reduce(
				(accum, key) => {
					if (key === keyId) {
						found = true;
						accum[key] = remoteKey.verify_keys[key];
					}

					return accum;
				},
				{} as Key["verify_keys"],
			);

			remoteKey.verify_keys = keys;

			console.log({
				msg: "after filter remote key",
				serverName,
				value: remoteKey,
			});

			if (!found) {
				return [];
			}
		}

		return [remoteKey as Key];
	}

	async signNotaryResponseKey(keys: Key) {
		const { signatures, _id, _createdAt, ...all } = keys;

		const signed = await signJson(
			all,
			this.config.signingKey[0],
			this.config.name,
		);

		return {
			...signed,
			signatures: {
				...signed.signatures,
				...signatures,
			},
		};
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
				const keys = await this.fetchAllkeysForServerName(
					serverName,
					keyId === 'undefined' ? undefined : keyId,
					minimumValidUntilTs,
				);
				response.server_keys = response.server_keys.concat(keys);
			}
		}

		return {
			server_keys: await Promise.all(
				response.server_keys.map(this.signNotaryResponseKey.bind(this)),
			),
		};
	}
}

export const routerWithKeyManager = (db: Db, config: Config) =>
	new Elysia().decorate("keys", KeysManager.createPlugin(db, config));

export type Context = InferContext<ReturnType<typeof routerWithKeyManager>>;
