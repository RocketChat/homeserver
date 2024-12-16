import { beforeAll, describe, expect, it } from "bun:test";
import Elysia from "elysia";
import { type SigningKey, generateKeyPairsFromString } from "../../keys";
import { toUnpaddedBase64 } from "../../binaryData";
import { sendTransactionRoute } from "./sendTransaction";
import { signJson } from "../../signJson";
import { signEvent } from "../../signEvent";
import { authorizationHeaders, generateId } from "../../authentication";

describe("/send/:txnId", () => {
	describe("PDU validation", () => {
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
						insertMany: async () => {
							return;
						},
					},
					serversCollection: {
						findOne: async () => {
							return;
						},
					} as any,
				})
				.use(sendTransactionRoute);
		});

		it("Should reject if there is more than 100 edus", async () => {
			const resp = await app.handle(
				new Request("https://localhost/send/txnId", {
					headers: {
						authorization: "Bearer invalid",
						"content-type": "application/json",
					},
					method: "PUT",
					body: JSON.stringify({
						edus: Array.from({ length: 101 }, (_, i) => ({
							content: {
								membership: "join",
								avatar_url: null,
								displayname: "rodrigo2",
							},
							origin: "synapse2",
							origin_server_ts: 1664987618773,
							sender: "@rodrigo2:synapse2",
							unsigned: {
								age: 2,
							},
						})),
					}),
				}),
			);

			expect(resp.status).toBe(400);
		});

		it("Should pass if there a proper pdu is provided", async () => {
			const signature = await generateKeyPairsFromString(
				"ed25519 a_yNbw tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8",
			);

			const pdu = {
				event_id: "1664987618773:synapse2",
				room_id: "!room:synapse2",
				type: "m.room.member",
				content: {
					membership: "join",
					avatar_url: null,
					displayname: "rodrigo2",
				},
				origin: "synapse2",
				origin_server_ts: 1664987618773,
				sender: "@rodrigo2:synapse2",
				unsigned: {
					age: 2,
				},
				auth_events: [
					"$A1NdD_Lf1IvcHeg0-pkApLWpKbputIaZ_Z4yIHK5YDg",
					"$dOOm8jYy4ioI77w2AbySU1NavHhU7US4Lukm76aOf5w",
					"$BLMgX0J7Gd4JZZzTsprQjJWtEfGlccgPUYC7XQyg2ds",
				],
				prev_events: ["$js6Vn-9W65pkvfigwsod3xqyvA7pRqDOKOcCJ69AxVs"],
				depth: 12,
			};

			const signedPdu = await signEvent(pdu, signature, "synapse2");

			const resp = await app.handle(
				new Request("https://localhost/send/txnId", {
					headers: {
						authorization: "Bearer invalid",
						"content-type": "application/json",
					},
					method: "PUT",
					body: JSON.stringify({
						pdus: [signedPdu],
					}),
				}),
			);

			const data = await resp.json();

			const id = generateId(signedPdu);
			expect(resp.status).toBe(200);
			expect(data).toHaveProperty("pdus");
			expect(data.pdus).toStrictEqual({
				[id]: {},
			});
		});

		it("Should reject if the pdu is invalid", async () => {
			const signature = await generateKeyPairsFromString(
				"ed25519 a_yNbw tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8",
			);

			const pdu = {
				event_id: "1664987618773:synapse2",
				room_id: "!room:synapse2",
				type: "m.room.member",
				content: {
					membership: "join",
					avatar_url: null,
					displayname: "rodrigo2",
				},
				origin: "synapse2",
				origin_server_ts: 1664987618773,
				sender: "@rodrigo2:synapse2",
				unsigned: {
					age: 2,
				},
			};

			const signedPdu = await signJson(pdu, signature, "synapse2");

			signedPdu.content.membership = "invalid";

			const resp = await app.handle(
				new Request("https://localhost/send/txnId", {
					headers: {
						authorization: "Bearer invalid",
						"content-type": "application/json",
					},
					method: "PUT",
					body: JSON.stringify({
						pdus: [signedPdu],
					}),
				}),
			);

			const data = await resp.json();
			expect(resp.status).toBe(200);
			expect(data).toHaveProperty("pdus");
			expect(data.pdus).toBeEmptyObject();
		});
	});
});

describe("/send/:txnId using real case", () => {
	describe("PDU validation", () => {
		let app: Elysia<any, any, any, any, any, any>;
		let signature: SigningKey;

		beforeAll(async () => {
			signature = await generateKeyPairsFromString(
				"ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw",
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
						insertMany: async () => {
							return;
						},
					},
					serversCollection: {
						findOne: async () => {
							return;
						},
					} as any,
				})
				.use(sendTransactionRoute);
		});

		it("real case", async () => {
			const signature = await generateKeyPairsFromString(
				"ed25519 a_HDhg tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8",
			);

			const request = {
				origin: "hs1",
				origin_server_ts: 1734360416888,
				pdus: [
					{
						auth_events: [
							"$A1NdD_Lf1IvcHeg0-pkApLWpKbputIaZ_Z4yIHK5YDg",
							"$dOOm8jYy4ioI77w2AbySU1NavHhU7US4Lukm76aOf5w",
							"$BLMgX0J7Gd4JZZzTsprQjJWtEfGlccgPUYC7XQyg2ds",
						],
						content: {
							body: "asd\\",
							format: "org.matrix.custom.html",
							formatted_body: "asd\\",
							"m.mentions": {},
							msgtype: "m.text",
						},
						depth: 12,
						hashes: {
							sha256: "Z5e0GuLx2lF2TZParpo1UOJpwx8ql3hkfym+SdAAgoE",
						},
						origin: "hs1",
						origin_server_ts: 1734360416852,
						prev_events: ["$L3Nf3O0e7d9qpU21L_LCWjTf5kQVCdTzEi64ucZ1FIY"],
						room_id: "!PyRgSwRCfDiTxTfIux:hs1",
						sender: "@admin:hs1",
						signatures: {
							hs1: {
								"ed25519:a_HDhg":
									"ZPXKe+WOWziHSLiRgcfs4E0eilrm6XmyHNIMEI2ENuoXR4DFto9/VIqWnk/dxqTz3GugwS4uPryTBNPB6sKmAQ",
							},
						},
						type: "m.room.message",
						unsigned: {
							age_ts: 1734360416852,
						},
					},
				],
			};
			const resp = await app.handle(
				new Request("https://localhost/send/txnId", {
					headers: {
						authorization: "Bearer invalid",
						"content-type": "application/json",
					},
					method: "PUT",
					body: JSON.stringify(request),
				}),
			);
			const id = generateId(request.pdus[0]);

			const data = await resp.json();
			expect(resp.status).toBe(200);
			expect(data).toHaveProperty("pdus");
			expect(data.pdus).toStrictEqual({
				[`${id}`]: {},
			});
		});
	});
});
