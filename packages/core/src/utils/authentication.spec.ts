import { describe, expect, it, test } from 'bun:test';

import {
	authorizationHeaders,
	computeAndMergeHash,
	computeHash,
	extractSignaturesFromHeader,
	signRequest,
	validateAuthorizationHeader,
} from './authentication';
import { generateId } from './generateId';
import { generateKeyPairsFromString } from './keys';
import { signJson } from './signJson';

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

test('signRequest', async () => {
	const signature = await generateKeyPairsFromString('ed25519 a_XRhW YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U');

	const event = Object.freeze({
		auth_events: [
			'$KMCKA2rA1vVCoN3ugpEnAja70o0jSksI-s2fqWy_1to',
			'$DcuwuadjnOUTC-IZmPdWHfCyxEgzuYcDvAoNpIJHous',
			'$tMNgmLPOG2gBqdDmNaT2iAjD54UQYaIzPpiGplxF5J4',
			'$8KCjO1lBtHMCUAYwe8y4-FMTwXnzXUb6F2g_Y6jHr4c',
		],
		prev_events: ['$KYvjqKYmahXxkpD7O_217w6P6g6DMrUixsFrJ_NI0nA'],
		type: 'm.room.member',
		room_id: '!EAuqyrnzwQoPNHvvmX:hs1',
		sender: '@admin:hs2',
		depth: 10,

		content: {
			// avatar_url: null,
			// displayname: "admin",
			membership: 'join',
		},

		hashes: {
			sha256: 'WUqhTZqxv+8GhGQv58qE/QFQ4Oua5BKqGFQGT35Dv10',
		},
		origin: 'hs2',
		origin_server_ts: 1733069433734,

		state_key: '@admin:hs2',
		signatures: {
			hs2: {
				'ed25519:a_XRhW': 'DR+DBqFTm7IUa35pFeOczsNw4shglIXW+3Ze63wC3dqQ4okzaSRgLuAUkYnVyxM2sZkSvlbeSBS7G6DeeaDEAA',
			},
		},
		unsigned: {
			age: 1,
		},
	});

	const signed = await signJson(event, signature, 'hs2');

	expect(signed).toHaveProperty('signatures');
	expect(signed.signatures).toBeObject();
	expect(signed.signatures).toHaveProperty('hs2');
	expect(signed.signatures.hs2).toBeObject();
	expect(signed.signatures.hs2).toHaveProperty('ed25519:a_XRhW');
	expect(signed.signatures.hs2['ed25519:a_XRhW']).toBeString();

	expect(signed.signatures.hs2['ed25519:a_XRhW']).toBe(
		'DR+DBqFTm7IUa35pFeOczsNw4shglIXW+3Ze63wC3dqQ4okzaSRgLuAUkYnVyxM2sZkSvlbeSBS7G6DeeaDEAA',
	);

	const signedRequest = await signRequest(
		'hs2',
		signature,
		'hs1',
		'PUT',
		'/_matrix/federation/v2/send_join/%21EAuqyrnzwQoPNHvvmX%3Ahs1/%24P4qGIj3TWoJBnr1IGzXEvgRd1IljQYqlFZkMI8_GmwY?omit_members=true',
		{
			...signed,
			content: {
				...signed.content,
				avatar_url: null,
				displayname: 'admin',
			},
		},
	);

	expect(signedRequest).toBeObject();
	expect(signedRequest).toHaveProperty('signatures');
	expect(signedRequest.signatures).toBeObject();
	expect(signedRequest.signatures).toHaveProperty('hs2');
	expect(signedRequest.signatures.hs2).toBeObject();
	expect(signedRequest.signatures.hs2).toHaveProperty('ed25519:a_XRhW');
	expect(signedRequest.signatures.hs2['ed25519:a_XRhW']).toBeString();

	expect(signedRequest.signatures.hs2['ed25519:a_XRhW']).toBe(
		'KDhgfpGp+34ElXpvFIBjsGO2kldNZKj1CWFEbSjyQR142ZYx+kIg+N3muLlMXEK0Fw76T/2vjihEWhwffsbcAg',
	);

	const id = generateId(event);

	expect(id).toBe('$P4qGIj3TWoJBnr1IGzXEvgRd1IljQYqlFZkMI8_GmwY');
});

describe('generateId', () => {
	test('should generate a consistent ID for the same event content', () => {
		const event = {
			type: 'm.room.message',
			sender: '@alice:example.com',
			room_id: '!someroom:example.com',
			content: {
				body: 'Hello world!',
				msgtype: 'm.text',
			},
			origin_server_ts: 1234567890,
		};
		const id1 = generateId(event);
		const id2 = generateId(event);

		expect(id1).toBe(id2);
	});

	test('should generate different IDs for different event content', () => {
		const event1 = {
			type: 'm.room.message',
			sender: '@alice:example.com',
			room_id: '!someroom:example.com',
			content: {
				body: 'Hello world!',
				msgtype: 'm.text',
			},
			origin_server_ts: 1234567890,
		};
		const event2 = {
			type: 'm.room.message',
			sender: '@bob:example.com', // Different sender
			room_id: '!someroom:example.com',
			content: {
				body: 'Hello world!',
				msgtype: 'm.text',
			},
			origin_server_ts: 1234567890,
		};

		const id1 = generateId(event1);
		const id2 = generateId(event2);

		expect(id1).not.toBe(id2);
	});

	test('should ignore fields like age_ts, unsigned, and signatures when generating ID', () => {
		const eventBase = {
			type: 'm.room.message',
			sender: '@alice:example.com',
			room_id: '!someroom:example.com',
			content: {
				body: 'Hello world!',
				msgtype: 'm.text',
			},
			origin_server_ts: 1234567890,
		};

		const eventWithExtraFields = {
			...eventBase,
			age_ts: 1234567890,
			unsigned: { age: 100 },
			signatures: { 'example.com': { 'ed25519:key': 'signature' } },
		};

		const id1 = generateId(eventBase);
		const id2 = generateId(eventWithExtraFields);

		expect(id1).toBe(id2);
	});
});
