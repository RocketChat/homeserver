import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mock, clearMocks } from "bun-bagel";

import { validateHeaderSignature } from "./validateHeaderSignature";
import Elysia from "elysia";
import { type SigningKey, generateKeyPairsFromString } from "../keys";
import { authorizationHeaders } from "../authentication";
import { toUnpaddedBase64 } from "../binaryData";
import { encodeCanonicalJson, signJson } from "../signJson";

describe("validateHeaderSignature getting public key from local", () => {
	let app: Elysia<any, any, any, any, any, any>;
	let signature: SigningKey;

	beforeAll(async () => {
		signature = await generateKeyPairsFromString(
			"ed25519 a_yNbw tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8",
		);

		app = new Elysia()
			.decorate("config", {
				path: "./config.json",
				signingKeyPath: "./keys/ed25519.signing.key",
				port: 8080,
				signingKey: [
					await generateKeyPairsFromString(
						"ed25519 a_XRhW YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U",
					),
				],
				name: "synapse2",
				version: "org.matrix.msc3757.10",
			})
			.decorate("mongo", {
				getValidPublicKeyFromLocal: async () => {
					return toUnpaddedBase64(signature.publicKey);
				},
				storePublicKey: async () => {
					return;
				},
				eventsCollection: {
					findOne: async () => {
						return;
					},
					findOneAndUpdate: async () => {
						return;
					},
				},
				serversCollection: {
					findOne: async () => {
						return;
					},
				} as any,
			})
			.onBeforeHandle(validateHeaderSignature)
			.get("/", () => "")
			.post("/", () => "");
	});

	it("Should reject if no authorization header", async () => {
		const resp = await app.handle(new Request("http://localhost/"));
		expect(resp.status).toBe(401);
	});
	it("Should reject if invalid authorization header is provided", async () => {
		const resp = await app.handle(
			new Request("http://localhost/", {
				headers: {
					authorization: "Bearer invalid",
				},
			}),
		);
		expect(resp.status).toBe(401);
	});

	it("Should reject if the origin is not the same as the config.name", async () => {
		const resp = await app.handle(
			new Request("http://localhost/", {
				headers: {
					authorization: "Bearer invalid",
				},
			}),
		);
		expect(resp.status).toBe(401);
	});

	it("Should pass if authorization header is valid with no body", async () => {
		const authorizationHeader = await authorizationHeaders(
			"synapse1",
			signature,
			"synapse2",
			"GET",
			"/",
		);

		const resp = await app.handle(
			new Request("http://localhost/", {
				headers: {
					authorization: authorizationHeader,
				},
			}),
		);
		expect(resp.status).toBe(200);
	});

	it("Should pass if authorization header is valid with body", async () => {
		const authorizationHeader = await authorizationHeaders(
			"synapse1",
			signature,
			"synapse2",
			"POST",
			"/",
			{
				test: 1,
			},
		);

		const resp = await app.handle(
			new Request("http://localhost/", {
				headers: {
					authorization: authorizationHeader,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					test: 1,
				}),
				method: "POST",
			}),
		);
		console.log("RESP->", await resp.text());
		expect(resp.status).toBe(200);
	});

	it("Should reject if the body is different from the signature", async () => {
		const authorizationHeader = await authorizationHeaders(
			"synapse1",
			signature,
			"synapse2",
			"POST",
			"/",
			{
				test: 1,
			},
		);

		const resp = await app.handle(
			new Request("http://localhost/", {
				headers: {
					authorization: authorizationHeader,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					test: 2,
				}),
				method: "POST",
			}),
		);
		expect(resp.status).toBe(401);
	});
});

describe("validateHeaderSignature getting public key from remote", () => {
	let app: Elysia<any, any, any, any, any, any>;
	let signature: SigningKey;
	afterEach(() => {
		clearMocks();
	});

	beforeAll(async () => {
		signature = await generateKeyPairsFromString(
			"ed25519 a_yNbw tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8",
		);

		app = new Elysia()
			.decorate("config", {
				path: "./config.json",
				signingKeyPath: "./keys/ed25519.signing.key",
				port: 8080,
				signingKey: [
					await generateKeyPairsFromString(
						"ed25519 a_XRhW YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U",
					),
				],
				name: "synapse2",
				version: "org.matrix.msc3757.10",
			})
			.decorate("mongo", {
				getValidPublicKeyFromLocal: async () => {
					return;
				},
				storePublicKey: async () => {
					return;
				},
				eventsCollection: {
					findOne: async () => {
						return;
					},
					findOneAndUpdate: async () => {
						return;
					},
				},
				serversCollection: {
					findOne: async () => {
						return {
							name: "synapse1",
						};
					},
				} as any,
			})
			.onBeforeHandle(validateHeaderSignature)
			.get("/", () => "")
			.post("/", () => "");
	});

	it("Should pass if authorization header is valid with no body synapse2 requesting from synapse1", async () => {
		const result = await signJson(
			{
				old_verify_keys: {},
				server_name: "synapse1",
				valid_until_ts: new Date().getTime() + 1000,
				verify_keys: {
					"ed25519:a_yNbw": {
						key: toUnpaddedBase64(signature.publicKey),
					},
				},
			},
			signature,
			"synapse1",
		);

		mock("https://synapse1/_matrix/key/v2/server", { data: result });

		const authorizationHeader = await authorizationHeaders(
			"synapse1",
			signature,
			"synapse2",
			"GET",
			"/",
		);

		const resp = await app.handle(
			new Request("http://localhost/", {
				headers: {
					authorization: authorizationHeader,
				},
			}),
		);

		expect(resp.status).toBe(200);
	});

	it("Should reject if authorization header is expired requesting from synapse1 (synapse2 delivered an already expired key)", async () => {
		const result = await signJson(
			{
				old_verify_keys: {},
				server_name: "synapse1",
				valid_until_ts: new Date().getTime() - 1000,
				verify_keys: {
					"ed25519:a_yNbw": {
						key: toUnpaddedBase64(signature.publicKey),
					},
				},
			},
			signature,
			"synapse1",
		);

		mock("https://synapse1/_matrix/key/v2/server", { data: result });

		const authorizationHeader = await authorizationHeaders(
			"synapse1",
			signature,
			"synapse2",
			"GET",
			"/",
		);

		const resp = await app.handle(
			new Request("http://localhost/", {
				headers: {
					authorization: authorizationHeader,
				},
			}),
		);

		expect(resp.status).toBe(401);
	});
});
