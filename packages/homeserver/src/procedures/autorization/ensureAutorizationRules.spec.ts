import { describe, expect, test } from "bun:test";
import { ensureAuthorizationRules } from "./ensureAuthorizationRules";
import { hs1 } from "../../fixtures/ContextBuilder";

describe("ensureAuthorizationRules", () => {
	test("it should pass - real case from synapse", async () => {
		const promise = ensureAuthorizationRules(
			[
				{
					auth_events: [],
					prev_events: [],
					type: "m.room.create",
					room_id: "!YrzBTuXYuWmkPFNPvP:hs1",
					sender: "@admin:hs1",
					content: {
						room_version: "10",
						creator: "@admin:hs1",
					},
					depth: 1,
					state_key: "",
					origin: "hs1",
					origin_server_ts: 1734749094984,
					// @ts-expect-error
					hashes: {
						sha256: "4eNVJv9TsqtwoOObcFcVlBzPngedlhHFMJzC6XlXO48",
					},
					signatures: {
						hs1: {
							"ed25519:a_HDhg":
								"bU3jArtCF6n3j1cJ6uvybisyX8vC9m9pTphN6VG1ju5MhpiVjtBlgHoVOM2ofGZ6JK01kuE6By6PwaV7qwj/Dg",
						},
					},
					unsigned: {
						age: 1193,
					},
				},
				{
					auth_events: [
						"$CUQnskjHihUMzzxepn2fvkAybKdmUglnbUyV4sw4UnE",
						"$xuZGslwbSTKYjCDAqlDsdvRy963ijx5lBIia2c2BOQw",
					],
					prev_events: ["$xuZGslwbSTKYjCDAqlDsdvRy963ijx5lBIia2c2BOQw"],
					type: "m.room.power_levels",
					room_id: "!YrzBTuXYuWmkPFNPvP:hs1",
					sender: "@admin:hs1",
					content: {
						users: {
							"@admin:hs1": 100,
							"@g21:rc1": 100,
						},
						users_default: 0,
						events: {
							"m.room.name": 50,
							"m.room.power_levels": 100,
							"m.room.history_visibility": 100,
							"m.room.canonical_alias": 50,
							"m.room.avatar": 50,
							"m.room.tombstone": 100,
							"m.room.server_acl": 100,
							"m.room.encryption": 100,
						},
						events_default: 0,
						state_default: 50,
						ban: 50,
						kick: 50,
						redact: 50,
						invite: 0,
						historical: 100,
					},
					depth: 3,
					state_key: "",
					origin: "hs1",
					origin_server_ts: 1734749095033,
					// @ts-expect-error
					hashes: {
						sha256: "caoUhtqs/bob6I4duim8flOAf9/qQP5t/aZ0g2ZJn2U",
					},
					signatures: {
						hs1: {
							"ed25519:a_HDhg":
								"dwH6+IoS1N+3c+PdMi8K21G6R4ndMJ7oK4ds3Ny9gUlh5i9qJpflE5YgSmY7tXJJaFxgu/ahHESMsmUZ1clJBQ",
						},
					},
					unsigned: {
						age: 1144,
					},
				},
				{
					auth_events: ["$CUQnskjHihUMzzxepn2fvkAybKdmUglnbUyV4sw4UnE"],
					prev_events: ["$CUQnskjHihUMzzxepn2fvkAybKdmUglnbUyV4sw4UnE"],
					type: "m.room.member",
					room_id: "!YrzBTuXYuWmkPFNPvP:hs1",
					sender: "@admin:hs1",
					content: {
						displayname: "admin",
						membership: "join",
					},
					depth: 2,
					state_key: "@admin:hs1",
					origin: "hs1",
					origin_server_ts: 1734749095014,
					// @ts-expect-error
					hashes: {
						sha256: "HseVbe6ngHdu2bJRVG9TfIy3HyQ+ZftmgYettfV0Kwc",
					},
					signatures: {
						hs1: {
							"ed25519:a_HDhg":
								"hwRDAopG7oSlEDt+V00hzGstHQixwdm86vexS9yT9eG13qXpDo7IQUmFxBVtGEPKnHs19yBCYMdBcrqBPK9eAA",
						},
					},
					unsigned: {
						age: 1163,
					},
				},
				{
					auth_events: [
						"$CUQnskjHihUMzzxepn2fvkAybKdmUglnbUyV4sw4UnE",
						"$xuZGslwbSTKYjCDAqlDsdvRy963ijx5lBIia2c2BOQw",
						"$pLzcU_5Kn3ir4HpYYee1XHVUTO3IvIqPmR2xDLxAL8I",
					],
					prev_events: ["$pLzcU_5Kn3ir4HpYYee1XHVUTO3IvIqPmR2xDLxAL8I"],
					type: "m.room.join_rules",
					room_id: "!YrzBTuXYuWmkPFNPvP:hs1",
					sender: "@admin:hs1",
					content: {
						join_rule: "invite",
					},
					depth: 4,
					state_key: "",
					origin: "hs1",
					origin_server_ts: 1734749095039,
					// @ts-expect-error
					hashes: {
						sha256: "A5zAjIbuy4uoPN8wasdasukqViu8Ox7WjTmUSjXgVFPTTsEY",
					},
					signatures: {
						hs1: {
							"ed25519:a_HDhg":
								"zwScOvaLrjAYAalWDHit6IB7O00xJ1zNy5/Q39H8aDcUt85pwzvEntNPxtDcIr3bq91p3wca6FXV9egjZ//sDQ",
						},
					},
					unsigned: {
						age: 1138,
					},
				},
			],
			"roomId",
		);
		expect(async () => promise).not.toThrow();
		const data = await promise;
		expect(data.size).toEqual(4);
	});

	test("it should pass - fake scenario made using createRoom", async () => {
		const hs1Context = await hs1.build();

		const room = await hs1Context.createRoom("@g21:hs1");

		const result = await ensureAuthorizationRules(
			room.events.map((event) => event.event),
			room.roomId,
		);

		expect(result.size).toEqual(6);
	});
});
