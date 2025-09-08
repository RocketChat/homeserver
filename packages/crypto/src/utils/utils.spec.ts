import { describe, expect, it } from 'bun:test';
import { encodeCanonicalJson, fromBase64ToBytes } from './data-types';
import {
	loadEd25519SignerFromSeed,
	loadEd25519VerifierFromPublicKey,
	signJson,
	verifyJsonSignature,
} from './keys';

// NOTE(deb): listing file names as I port the tests
// can and should be removed later, won't have must point later

async function getSignerFromKeyContent(content: string) {
	// biome-ignore lint/style/noNonNullAssertion: I can see pop won't fail, input isn't unknown -__-
	const seed = content.split(' ').pop()!;
	const seedBytes = fromBase64ToBytes(seed);

	//vvv
	const signer = await loadEd25519SignerFromSeed(seedBytes);

	return signer;
}

// authentication.spec.ts (packages/core)
describe('Signing and verifying payloads', async () => {
	const seedFileContent =
		'ed25519 a_XRhW YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U';

	const signer = await getSignerFromKeyContent(seedFileContent);

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
				'ed25519:a_XRhW':
					'DR+DBqFTm7IUa35pFeOczsNw4shglIXW+3Ze63wC3dqQ4okzaSRgLuAUkYnVyxM2sZkSvlbeSBS7G6DeeaDEAA',
			},
		},
		unsigned: {
			age: 1,
		},
	});

	it('should generate the correct signature for an event', async () => {
		const { signatures, unsigned, ...rest } = event;

		const signature = await signJson(rest, signer);

		expect(signature).toBe(signatures.hs2['ed25519:a_XRhW']);
	});

	// signJson.spec.ts (packages/federation-sdk)
	it('should verify a valid signature', async () => {
		const content =
			'ed25519 a_yNbw tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8';
		const signer = await getSignerFromKeyContent(content);

		const signature = await signJson({}, signer);

		// now use the public key to verify
		await verifyJsonSignature({}, signature, signer);
	});

	it('should throw an error if the signature is invalid', async () => {
		const content =
			'ed25519 a_yNbw tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8';
		const signer = await getSignerFromKeyContent(content);

		const signature = await signJson({}, signer);

		const diffPublicKeyContent = 'tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8';

		const verifier = await loadEd25519VerifierFromPublicKey(
			fromBase64ToBytes(diffPublicKeyContent),
			'0',
		);

		expect(() => verifyJsonSignature({}, signature, verifier)).rejects;
	});
});

describe('Canonical json serialization', () => {
	// these cases are all llm generated FYI
	// write all input and expected outputs, be verbose, cater to all problematic spaces when it comes to json serialization
	const testCases: Array<{ input: Record<string, unknown>; expected: string }> =
		[
			{
				input: { b: 1, a: 2 },
				expected: '{"a":2,"b":1}',
			},
			{
				input: { a: { d: 4, c: 3 }, b: 2 },
				expected: '{"a":{"c":3,"d":4},"b":2}',
			},
			{
				input: { a: [2, 1], b: 3 },
				expected: '{"a":[2,1],"b":3}',
			},
			{
				input: { a: 'string with spaces', b: 2 },
				expected: '{"a":"string with spaces","b":2}',
			},
			{
				input: { a: 'string with "quotes"', b: 2 },
				expected: '{"a":"string with \\"quotes\\"","b":2}',
			},
			{
				input: { a: 'string with \\ backslash', b: 2 },
				expected: '{"a":"string with \\\\ backslash","b":2}',
			},
			{
				input: { a: 'string with \n new line', b: 2 },
				expected: '{"a":"string with \\n new line","b":2}',
			},
			{
				input: { a: 'string with \t tab', b: 2 },
				expected: '{"a":"string with \\t tab","b":2}',
			},
			// add more, play with long spaces
			{
				input: { a: '   leading and trailing spaces   ', b: 2 },
				expected: '{"a":"   leading and trailing spaces   ","b":2}',
			},
			{
				input: { a: 'multiple     spaces', b: 2 },
				expected: '{"a":"multiple     spaces","b":2}',
			},
			{
				input: { a: { b: { c: { d: 'deep' } } }, e: [5, 4, 3, 2, 1] },
				expected: '{"a":{"b":{"c":{"d":"deep"}}},"e":[5,4,3,2,1]}',
			},
			{
				input: { a: null, b: true, c: false, d: 0, e: '' },
				expected: '{"a":null,"b":true,"c":false,"d":0,"e":""}',
			},
			{
				input: {
					a: [
						{ b: 2, a: 1 },
						{ d: 4, c: 3 },
					],
					e: 5,
				},
				expected: '{"a":[{"a":1,"b":2},{"c":3,"d":4}],"e":5}',
			},
			// add more with numbers and letters mixed together
			{
				input: { a1: 'value1', a10: 'value10', a2: 'value2' },
				expected: '{"a1":"value1","a10":"value10","a2":"value2"}',
			},
			{
				input: { z: 1, y: { b: 2, a: 1 }, x: [3, 2, 1] },
				expected: '{"x":[3,2,1],"y":{"a":1,"b":2},"z":1}',
			},
			{
				input: { ' key with spaces ': 'value', normalKey: 'value2' },
				expected: '{" key with spaces ":"value","normalKey":"value2"}',
			},
			// add more with unicode characters
			{
				input: { a: 'üñîçødé', b: '测试', c: 'тест' },
				expected: '{"a":"üñîçødé","b":"测试","c":"тест"}',
			},
			{
				input: { a: 'emoji 😊', b: '🚀🌟' },
				expected: '{"a":"emoji 😊","b":"🚀🌟"}',
			},
			// empty structures
			{ input: {}, expected: '{}' },
			{ input: { a: {} }, expected: '{"a":{}}' },
			{ input: { a: [] }, expected: '{"a":[]}' },
			{ input: { a: { b: [] } }, expected: '{"a":{"b":[]}}' },
			{ input: { a: [1, { b: 2 }, []] }, expected: '{"a":[1,{"b":2},[]]}' },
			// ----------
			// Nested arrays with mixed types
			{
				input: { arr: [1, 'two', { b: 2, a: 1 }, [3, 4]] },
				expected: '{"arr":[1,"two",{"a":1,"b":2},[3,4]]}',
			},
			// Boolean values mixed in arrays and objects
			{
				input: { a: true, b: false, c: [false, true, { d: false, e: true }] },
				expected: '{"a":true,"b":false,"c":[false,true,{"d":false,"e":true}]}',
			},
			// Numbers – including floating points, negative, zero, exponential notation
			{
				input: { a: 0, b: -0, c: 1.234, d: -5.67, e: 1e3, f: -2.5e-2 },
				expected: '{"a":0,"b":0,"c":1.234,"d":-5.67,"e":1000,"f":-0.025}',
			},
			// Empty strings and keys with empty string
			{
				input: { '': 'emptyKey', a: '', b: 'non-empty' },
				expected: '{"":"emptyKey","a":"","b":"non-empty"}',
			},
			// Null values nested deeply
			{
				input: { a: null, b: { c: null, d: [null, { e: null }] } },
				expected: '{"a":null,"b":{"c":null,"d":[null,{"e":null}]}}',
			},
			// Escape sequences inside strings including backspace, form feed, carriage return
			{
				input: { a: 'backspace\b', b: 'formfeed\f', c: 'carriage\r' },
				expected: '{"a":"backspace\\b","b":"formfeed\\f","c":"carriage\\r"}',
			},
			// Unicode escape sequences in strings should remain as characters (not \u escapes)
			{
				input: { a: '\u2603', b: '\uD83D\uDE00' }, // ☃ and 😀
				expected: '{"a":"☃","b":"😀"}',
			},
			// Object keys with numeric strings and sort order (should be lex sorted)
			{
				input: { '1': 'one', '10': 'ten', '2': 'two' },
				expected: '{"1":"one","10":"ten","2":"two"}',
			},
			// Mix of array and object nesting with empty elements
			{
				input: { a: [], b: {}, c: [{}, [], [{}]] },
				expected: '{"a":[],"b":{},"c":[{},[],[{}]]}',
			},
			// Large nested structure with mixed types
			{
				input: {
					z: [5, { x: 10, y: [1, 2, 3], a: { b: 'c' } }],
					a: 'test',
					m: false,
					n: null,
				},
				expected:
					'{"a":"test","m":false,"n":null,"z":[5,{"a":{"b":"c"},"x":10,"y":[1,2,3]}]}',
			},
			// Special number values for JSON (NaN, Infinity) should be omitted or converted to null
			// This is tricky because canonical JSON doesn't support them; test if expected behavior is null
			{
				input: {
					a: Number.NaN,
					b: Number.POSITIVE_INFINITY,
					c: Number.NEGATIVE_INFINITY,
					d: 1,
				},
				expected: '{"a":null,"b":null,"c":null,"d":1}',
			},
			// Keys with special characters
			{
				input: { 'key\nnewLine': 1, 'key"quote': 2, 'key\\backslash': 3 },
				expected: '{"key\\nnewLine":1,"key\\"quote":2,"key\\\\backslash":3}',
			},
			// Deeply nested empty objects and arrays
			{
				input: { a: { b: { c: { d: {} } } }, e: [[[[]]]] },
				expected: '{"a":{"b":{"c":{"d":{}}}},"e":[[[[]]]]}',
			},
			// Keys that differ only by case (JSON keys are case-sensitive)
			{
				input: { a: 1, A: 2 },
				expected: '{"A":2,"a":1}',
			},
			// Array of mixed empty values
			{
				input: { a: [null, '', 0, false, {}, []] },
				expected: '{"a":[null,"",0,false,{},[]]}',
			},
			// Very long string with mixed whitespace characters
			{
				input: { a: ' \t\n\r  mixed\t whitespace\n\r ' },
				expected: '{"a":" \\t\\n\\r  mixed\\t whitespace\\n\\r "}',
			},
			{
				input: { 'key\nnewLine': 1, 'key"quote': 2, 'key\\backslash': 3 },
				expected: '{"key\\nnewLine":1,"key\\"quote":2,"key\\\\backslash":3}',
			},
			{
				input: { 'line\rreturn': 10, 'tab\tkey': 20, 'form\ffeed': 30 },
				expected: '{"form\\ffeed":30,"line\\rreturn":10,"tab\\tkey":20}',
			},
			{
				input: {
					'quote"inside': 'value',
					'back\\slash': 'test',
					'new\nline': 'data',
				},
				expected:
					'{"back\\\\slash":"test","new\\nline":"data","quote\\"inside":"value"}',
			},
			{
				input: { 'mix\'ed"esc\\apes\n': 100 },
				expected: '{"mix\'ed\\"esc\\\\apes\\n":100}',
			},
			{
				input: { normal: 1, 'space key': 2, 'slash/key': 3, 'dot.key': 4 },
				expected: '{"dot.key":4,"normal":1,"slash/key":3,"space key":2}',
			},
			{
				input: { '\bbackspace': 'bs', '\fformfeed': 'ff', '\rcarriage': 'cr' },
				expected: '{"\\bbackspace":"bs","\\fformfeed":"ff","\\rcarriage":"cr"}',
			},
		];

	testCases.forEach(({ input, expected }, index) => {
		it(`should serialize correctly for test case #${index + 1}`, () => {
			const serialized = encodeCanonicalJson(input);
			expect(serialized).toBe(expected);
		});
	});
});
