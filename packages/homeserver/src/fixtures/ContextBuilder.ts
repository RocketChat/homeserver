import Elysia from "elysia";
import Crypto from "node:crypto";

import { type SigningKey, generateKeyPairsFromString } from "../keys";
import { toUnpaddedBase64 } from "../binaryData";
import type {
	getAllResponsesByMethod,
	getAllResponsesByPath,
} from "../makeRequest";
import { authorizationHeaders, generateId } from "../authentication";
import type { HomeServerRoutes } from "../app";
import type { EventBase } from "@hs/core/src/events/eventBase";
import type { EventStore } from "../plugins/mongodb";
import { createRoom } from "../procedures/createRoom";
import { createSignedEvent } from "@hs/core/src/events/utils/createSignedEvent";

type MockedFakeRequest = <
	M extends HomeServerRoutes["method"],
	U extends getAllResponsesByMethod<HomeServerRoutes, M>["path"],
>(
	method: M,
	uri: U,
	body: getAllResponsesByPath<HomeServerRoutes, M, U>["body"],
) => Promise<Request>;

export function createMediaId(length: number) {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	let result = "";
	for (let i = 0; i < length; i++) {
		const randomIndex = Crypto.randomInt(0, characters.length);
		result += characters[randomIndex];
	}
	return result;
}

class MockedRoom {
	public events: EventStore[] = [];
	constructor(
		public roomId: string,
		events: EventStore[],
	) {
		for (const event of events) {
			this.events.push(event);
		}
	}
}

export class ContextBuilder {
	private config: any;
	private mongo: any;
	private mutex: any;
	private signingSeed: any;

	private events: Map<string, EventStore[]> = new Map();

	private localRemoteSigningKeys: Map<string, SigningKey> = new Map();
	private remoteRemoteSigningKeys: Map<string, SigningKey> = new Map();

	constructor(private name: string) { }
	static create(name: string) {
		return new ContextBuilder(name);
	}

	public withName(name: string) {
		this.name = name;
		return this;
	}

	public withEvent(roomId: string, event: EventBase) {
		const arr = this.events.get(roomId) || [];
		arr.push({
			_id: generateId(event),
			event,
		});
		this.events.set(roomId, arr);
		return this;
	}

	public withConfig(config: any) {
		this.config = config;
		return this;
	}

	public withMongo(mongo: any) {
		this.mongo = mongo;
		return this;
	}

	public withMutex(mutex: any) {
		this.mutex = mutex;
		return this;
	}

	public withSigningKey(signingSeed: string) {
		this.signingSeed = signingSeed;
		return this;
	}

	public withLocalSigningKey(remote: string, signingKey: SigningKey) {
		this.localRemoteSigningKeys.set(remote, signingKey);
		return this;
	}

	public withRemoteSigningKey(remote: string, signingKey: SigningKey) {
		this.remoteRemoteSigningKeys.set(remote, signingKey);
		return this;
	}

	public async build(): Promise<{
		signature: SigningKey;
		name: string;
		app: Elysia<any, any, any, any, any, any>;
		instance: ContextBuilder;
		makeRequest: MockedFakeRequest;
		createRoom: (sender: string, ...members: string[]) => Promise<MockedRoom>;
	}> {
		const signature = await generateKeyPairsFromString(this.signingSeed);

		const config = {
			path: "./config.json",
			signingKeyPath: "./keys/ed25519.signing.key",
			port: 8080,
			signingKey: [signature],
			name: this.name,
			version: "org.matrix.msc3757.10",
		};
		const app = new Elysia()
			.decorate("mongo", {
				getValidServerKeysFromLocal: async (origin: string, key: string) => {
					const signingKey = this.localRemoteSigningKeys.get(origin);
					if (!signingKey) {
						return;
					}
					return { verify_keys: { [`${signingKey.algorithm}:${signingKey.version}`]: { key: toUnpaddedBase64(signingKey.publicKey) } } };
				},
				getOldestStagedEvent: async (roomId: string) => {
					return this.events.get(roomId)?.[0];
				},
				getEventsByIds: async (roomId: string, eventIds: string[]) => {
					return (
						this.events
							.get(roomId)
							?.filter((event) => eventIds.includes(event._id)) ?? []
					);
				},
				createStagingEvent: async (event: EventBase) => {
					const id = generateId(event);
					this.events.get(event.room_id)?.push({
						_id: id,
						event,
						staged: true,
					});
					return id;
				},
				createEvent: async (event: EventBase) => {
					const id = generateId(event);
					this.events.get(event.room_id)?.push({
						_id: id,
						event,
					});
				},
			})
			.decorate("config", config);

		const makeRequest: MockedFakeRequest = async (method, uri, body) => {
			const signingName = this.name;
			const domain = "localhost";

			return new Request(`https://${domain}${uri}`, {
				headers: {
					authorization: await authorizationHeaders(
						signingName,
						signature,
						domain,
						method,
						uri,
						body as any,
					),
					"content-type": "application/json",
				},
				method,
				body: body && JSON.stringify(body),
			});
		};

		return {
			signature,
			name: this.name,
			app,
			instance: this,
			makeRequest,
			createRoom: async (sender: string, ...members: string[]) => {
				const { roomId, events } = await createRoom(
					[
						`@${sender}:${config.name}`,
						...members.map((member) => `@${member}:${config.name}`),
					],
					createSignedEvent(config.signingKey[0], config.name),
					`!${createMediaId(18)}:${config.name}`,
				);

				for (const { event } of events) {
					this.withEvent(roomId, event);
				}
				return new MockedRoom(roomId, events);
			},
		};
	}
}

export const rc1 = ContextBuilder.create("rc1").withSigningKey(
	"ed25519 a_yNbw tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8",
);

export const hs1 = ContextBuilder.create("hs1").withSigningKey(
	"ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw",
);

export const hs2 = ContextBuilder.create("hs2").withSigningKey(
	"ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw",
);
