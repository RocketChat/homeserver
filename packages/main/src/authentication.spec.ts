import { expect, test } from "bun:test";

import { computeHash, generateId, signRequest } from "./authentication";
import { generateKeyPairs } from "./keys";
import { signJson, signText } from "./signJson";

// {
//     "content": {
//         "auth_events": [
//             "$aokhD3KlL_EHZ67626nn_aHMPW9K3T7rvT7IkrZaMbI",
//             "$-aRadmHs-xyc4xVWx38FmlIaM6xafoJsqCj3fVbkO-Q",
//             "$NAL56UfuEcLlL2kjmOYZvd5dQJY59Sxxp3l42iBNenw",
//             "$smcGuuNx478aANd8STTp0bDI94ER93vldR-_mO_KLyU"
//         ],
//         "content": {
//             "membership": "join"
//         },
//         "depth": 10,
//         "hashes": {
//             "sha256": "YBZHC60WOdOVDB2ISkVTnbg/L7J9qYBKWY+lUSZYIUk"
//         },
//         "origin": "synapse2",
//         "origin_server_ts": 1732999153019,
//         "prev_events": [
//             "$UqTWV2zA0fLTB2gj9iemXVyjamrt5X6GsSTnCQAtmik"
//         ],
//         "room_id": "!JVkUxGlBLsuOwTBUpN:synapse1",
//         "sender": "@rodrigo2:synapse2",
//         "signatures": {
//             "synapse2": {
//                 "ed25519:a_yNbw": "NKSz4x8fKwoNOOY/rcVVkVrzzt/TyFaL+8IJX9raSZNrMZFH5J3s2l+Z85q8McAUPp/pKKctI4Okk0Q7Q8OOBA"
//             }
//         },
//         "state_key": "@rodrigo2:synapse2",
//         "type": "m.room.member",
//         "unsigned": {
//             "age": 2
//         }
//     },
//     "destination": "synapse1",
//     "method": "PUT",
//     "origin": "synapse2",
//     "signatures": {
//         "synapse2": {
//             "ed25519:a_yNbw": "lxdmBBy9OtgsmRDbm1I3dhyslE4aFJgCcg48DBNDO0/rK4d7aUX3YjkDTMGLyugx9DT+s34AgxnBZOWRg1u6AQ"
//         }
//     },
//     "uri": "/_matrix/federation/v2/send_join/%21JVkUxGlBLsuOwTBUpN%3Asynapse1/%24UOFwq4Soj_komm7BQx5zhf-AmXiPw1nkTycvdlFT5tk?omit_members=true"
// }

test("signRequest", async () => {
	const [signature] = await generateKeyPairs(
		Uint8Array.from(atob("YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U"), (c) =>
			c.charCodeAt(0),
		),
	);

	const event = Object.freeze({
		auth_events: [
			"$KMCKA2rA1vVCoN3ugpEnAja70o0jSksI-s2fqWy_1to",
			"$DcuwuadjnOUTC-IZmPdWHfCyxEgzuYcDvAoNpIJHous",
			"$tMNgmLPOG2gBqdDmNaT2iAjD54UQYaIzPpiGplxF5J4",
			"$8KCjO1lBtHMCUAYwe8y4-FMTwXnzXUb6F2g_Y6jHr4c",
		],
		prev_events: ["$KYvjqKYmahXxkpD7O_217w6P6g6DMrUixsFrJ_NI0nA"],
		type: "m.room.member",
		room_id: "!EAuqyrnzwQoPNHvvmX:hs1",
		sender: "@admin:hs2",
		depth: 10,

		content: {
			// avatar_url: null,
			// displayname: "admin",
			membership: "join",
		},

		hashes: {
			sha256: "WUqhTZqxv+8GhGQv58qE/QFQ4Oua5BKqGFQGT35Dv10",
		},
		origin: "hs2",
		origin_server_ts: 1733069433734,

		state_key: "@admin:hs2",
		signatures: {
			hs2: {
				"ed25519:a_XRhW":
					"DR+DBqFTm7IUa35pFeOczsNw4shglIXW+3Ze63wC3dqQ4okzaSRgLuAUkYnVyxM2sZkSvlbeSBS7G6DeeaDEAA",
			},
		},
		unsigned: {
			age: 1,
		},
	});

	const signed = await signJson(
		event,
		{
			algorithm: "ed25519",
			version: "a_XRhW",
			sign(data: Uint8Array) {
				return signText(data, signature.privateKey);
			},
		},
		"hs2",
	);

	expect(signed).toHaveProperty("signatures");
	expect(signed.signatures).toBeObject();
	expect(signed.signatures).toHaveProperty("hs2");
	expect(signed.signatures.hs2).toBeObject();
	expect(signed.signatures.hs2).toHaveProperty("ed25519:a_XRhW");
	expect(signed.signatures.hs2["ed25519:a_XRhW"]).toBeString();

	expect(signed.signatures.hs2["ed25519:a_XRhW"]).toBe(
		"DR+DBqFTm7IUa35pFeOczsNw4shglIXW+3Ze63wC3dqQ4okzaSRgLuAUkYnVyxM2sZkSvlbeSBS7G6DeeaDEAA",
	);

	const signedRequest = await signRequest(
		"hs2",
		{
			algorithm: "ed25519",
			version: "a_XRhW",
			sign(data: Uint8Array) {
				return signText(data, signature.privateKey);
			},
		},
		"hs1",
		"PUT",
		"/_matrix/federation/v2/send_join/%21EAuqyrnzwQoPNHvvmX%3Ahs1/%24P4qGIj3TWoJBnr1IGzXEvgRd1IljQYqlFZkMI8_GmwY?omit_members=true",
		{
			...signed,
			content: {
				...signed.content,
				avatar_url: null,
				displayname: "admin",
			},
		},
	);

	expect(signedRequest).toBeObject();
	expect(signedRequest).toHaveProperty("signatures");
	expect(signedRequest.signatures).toBeObject();
	expect(signedRequest.signatures).toHaveProperty("hs2");
	expect(signedRequest.signatures.hs2).toBeObject();
	expect(signedRequest.signatures.hs2).toHaveProperty("ed25519:a_XRhW");
	expect(signedRequest.signatures.hs2["ed25519:a_XRhW"]).toBeString();

	expect(signedRequest.signatures.hs2["ed25519:a_XRhW"]).toBe(
		"KDhgfpGp+34ElXpvFIBjsGO2kldNZKj1CWFEbSjyQR142ZYx+kIg+N3muLlMXEK0Fw76T/2vjihEWhwffsbcAg",
	);

	const id = generateId(event);

	expect(id).toBe("$P4qGIj3TWoJBnr1IGzXEvgRd1IljQYqlFZkMI8_GmwY");
});

test("computeHash", async () => {
	const result = computeHash({
		auth_events: [
			"$e0YmwnKseuHqsuF50ekjta7z5UpO-bDoq7y4R1NKMpI",
			"$6_VX-xW821oaBwOuaaV_xoC6fD2iMg2QPWD4J7Bh3o4",
			"$9m9s2DShzjg5WBpAsj2lfOSFVCHBJ1DIpayouOij5Nk",
			"$fmahdKvkzQlGFCj9WM_eDtbI3IG08J6DNyqEFpgAT7Q",
		],
		content: { membership: "join" },
		depth: 9,
		origin: "synapse1",
		origin_server_ts: 1733002629635,
		prev_events: ["$lD8jXrQmHr7KhxekqNPHFC-gzjYq3Gf_Oyr896K69JY"],
		room_id: "!bhjQdfkUhiyKSsJbFt:synapse1",
		sender: "@asd11:homeserver",
		state_key: "@asd11:homeserver",
		type: "m.room.member",
		unsigned: { age: 2 },
		signatures: {},
	});

	expect(result.hashes.sha256).toBe(
		"nPC9Qk7Amj+ykakbc25gzyyCdHrukUflCNeAM5DGoU4",
	);
});
