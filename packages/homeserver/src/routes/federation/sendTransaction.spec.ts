import { beforeAll, describe, expect, it } from "bun:test";
import type Elysia from "elysia";
import { type SigningKey, generateKeyPairsFromString } from "../../keys";
import { toUnpaddedBase64 } from "../../binaryData";
import { sendTransactionRoute } from "./sendTransaction";
import { signJson } from "../../signJson";
import { signEvent } from "../../signEvent";
import { authorizationHeaders, generateId } from "../../authentication";
import { type ContextBuilder, hs1, rc1 } from "../../fixtures/ContextBuilder";
import { pruneEventDict } from "../../pruneEventDict";

describe("/send/:txnId", () => {
	describe("PDU validation", () => {
		let app: Elysia<any, any, any, any, any, any>;
		let signature: SigningKey;

		let hs1Content: Awaited<ReturnType<ContextBuilder["build"]>>;
		let rc1Content: Awaited<ReturnType<ContextBuilder["build"]>>;

		beforeAll(async () => {
			hs1Content = await hs1.build();
			rc1.withLocalSigningKey("hs1", hs1Content.signature);
			rc1Content = await rc1.build();
			hs1.withLocalSigningKey("rc1", rc1Content.signature);
			hs1Content = await hs1.build();

			signature = rc1Content.signature;
			app = rc1Content.app.group("/_matrix/federation/v1", (app) =>
				app.use(sendTransactionRoute),
			);
		});

		it("Should reject if there is more than 100 edus", async () => {
			const transactionid = "asd";

			const resp = await app.handle(
				await hs1Content.makeRequest<
					"PUT",
					`/_matrix/federation/v1/send/${string}`
				>("PUT", `/_matrix/federation/v1/send/${transactionid}`, {
					edus: Array.from({ length: 101 }, (_, i) => ({
						content: {
							membership: "join",
							avatar_url: null,
							displayname: "rodrigo2",
						},
						origin: "hs1",
						origin_server_ts: 1664987618773,
						sender: "@rodrigo2:hs1",
						unsigned: {
							age: 2,
						},
					})),
				}),
			);

			expect(resp.status).toBe(400);
		});

		it("Should pass if there a proper pdu is provided", async () => {
			rc1Content = await rc1.build();
			app = rc1Content.app.group("/_matrix/federation/v1", (app) =>
				app.use(sendTransactionRoute),
			);

			const transactionid = "asd";

			const pdu = {
				event_id: "1664987618773:hs1",
				room_id: "!room:hs1",
				type: "m.room.member",
				content: {
					membership: "join",
					avatar_url: null,
					displayname: "rodrigo2",
				},
				origin: "hs1",
				origin_server_ts: 1664987618773,
				sender: "@rodrigo2:hs1",
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

			const signedPdu = await signEvent(pdu, hs1Content.signature, "hs1");

			const resp = await app.handle(
				await hs1Content.makeRequest<
					"PUT",
					`/_matrix/federation/v1/send/${string}`
				>("PUT", `/_matrix/federation/v1/send/${transactionid}`, {
					pdus: [signedPdu],
				}),
			);

			const data = await resp.json();

			const id = generateId(signedPdu);
			expect(resp.status).toBe(200);
			expect(data).toHaveProperty("pdus");
			expect(data.pdus).toStrictEqual({
				pdus: {
					[id]: {},
				},
			});
		});

		it("Should reject if the pdu is invalid", async () => {
			const pdu = {
				room_id: "!room:hs1",
				type: "m.room.member",
				content: {
					membership: "join",
					avatar_url: null,
					displayname: "rodrigo2",
				},
				auth_events: [
					"$A1NdD_Lf1IvcHeg0-pkApLWpKbputIaZ_Z4yIHK5YDg",
					"$dOOm8jYy4ioI77w2AbySU1NavHhU7US4Lukm76aOf5w",
					"$BLMgX0J7Gd4JZZzTsprQjJWtEfGlccgPUYC7XQyg2ds",
				],
				prev_events: ["$js6Vn-9W65pkvfigwsod3xqyvA7pRqDOKOcCJ69AxVs"],
				origin: "hs1",
				origin_server_ts: 1664987618773,
				sender: "@rodrigo2:hs1",
				unsigned: {
					age: 2,
				},
				depth: 12,
			};
			const transactionid = "asd";

			const signedPdu = await signJson(
				pruneEventDict(pdu),
				hs1Content.signature,
				"hs1",
			);

			signedPdu.content!.membership = "invalid";

			const resp = await app.handle(
				await hs1Content.makeRequest<
					"PUT",
					`/_matrix/federation/v1/send/${string}`
				>("PUT", `/_matrix/federation/v1/send/${transactionid}`, {
					pdus: [signedPdu],
					edus: [],
				}),
			);

			const data = await resp.json();
			const id = generateId(signedPdu);
			expect(resp.status).toBe(200);
			expect(data).toHaveProperty("pdus");
			expect(data.pdus).toStrictEqual({
				pdus: {
					[id]: {
						error: {},
					},
				},
			});
		});
	});
});

describe("/send/:txnId using real case", () => {
	describe("PDU validation", () => {
		let app: Elysia<any, any, any, any, any, any>;

		let hs1Content: Awaited<ReturnType<ContextBuilder["build"]>>;
		let signature: SigningKey;

		beforeAll(async () => {
			hs1Content = await hs1.build();
			rc1.withLocalSigningKey("hs1", hs1Content.signature);
			const rc1Content = await rc1.build();

			signature = rc1Content.signature;
			app = rc1Content.app.group("/_matrix/federation/v1", (app) =>
				app.use(sendTransactionRoute),
			);
		});

		it("real case", async () => {
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
				new Request("https://localhost/_matrix/federation/v1/send/txnId", {
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
				pdus: {
					[`${id}`]: {},
				},
			});
		});
	});
});
