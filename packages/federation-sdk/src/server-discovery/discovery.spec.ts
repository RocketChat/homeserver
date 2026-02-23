import { describe, expect, it, mock } from 'bun:test';

import sinon from 'sinon';

import { _URL } from './_url';
import { getHomeserverFinalAddress } from './discovery';

const stubs = {
	fetch: sinon.stub(),

	resolveHostname: sinon.stub(),
	resolveSrv: sinon.stub(),
} as const;

await mock.module('./discovery', () => ({
	resolveHostname: stubs.resolveHostname,
}));

await mock.module('./_resolver', () => ({
	resolver: {
		resolveSrv: stubs.resolveSrv,
	},
}));

const mockFetch = stubs.fetch as unknown as typeof fetch;
// const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch;

// each function describes a stage of the spec to test spec conformity
// function returns the set of inputs to test with.
// each step should behave the same way so the modifications to the stub returns should not change.
//

type INPUT = string;
type OUTPUT = [`https://${string}:${string | number}`, { Host: string }];

/*
 * 1. If the hostname is an IP literal, then that IP address should be used, together with the given port number, or 8448 if no port is given. The target server must present a valid certificate for the IP address. The Host header in the request should be set to the server name, including the port if the server name included one.
 */

function spec_1__1(): [INPUT[], OUTPUT[]] {
	return [
		['11.0.0.1', '11.0.0.1:45'],
		[
			['https://11.0.0.1:8448' as const, { Host: '11.0.0.1' }],
			['https://11.0.0.1:45' as const, { Host: '11.0.0.1:45' }],
		],
	];
}

function spec_1__2(): [INPUT[], OUTPUT[]] {
	return [
		['[::1]', '[::1]:45'],
		[
			['https://[::1]:8448' as const, { Host: '[::1]' }],
			['https://[::1]:45' as const, { Host: '[::1]:45' }],
		],
	];
}

/*
 * SPEC:
 * 2. If the hostname is not an IP literal, and the server name includes an explicit port, resolve the hostname to an IP address using CNAME, AAAA or A records. Requests are made to the resolved IP address and given port with a Host header of the original server name (with port). The target server must present a valid certificate for the hostname.
 */

function spec_2__1(): [INPUT[], OUTPUT[]] {
	stubs.resolveHostname.resolves('11.0.0.1');
	return [['example.com:45'], [['https://11.0.0.1:45' as const, { Host: 'example.com:45' }]]];
}

function spec_2__2(): [INPUT[], OUTPUT[]] {
	stubs.resolveHostname.resolves('[::1]');
	return [['example_spec_2__2.com:45'], [['https://[::1]:45' as const, { Host: 'example_spec_2__2.com:45' }]]];
}

// wellknown
// If <delegated_hostname> is an IP literal, then that IP address should be used together with the <delegated_port> or 8448 if no port is provided. The target server must present a valid TLS certificate for the IP address. Requests must be made with a Host header containing the IP address, including the port if one was provided.
function spec_3_1__1(): [INPUT[], OUTPUT[]] {
	// If the hostname is not an IP literal and no port is provided
	const inputs = ['example_spec_3_1__1.com'];

	stubs.resolveHostname.resolves('11.0.0.1');

	// Mock the .well-known response
	stubs.fetch.resolves({
		ok: true,
		json: () => Promise.resolve({ 'm.server': '11.0.0.1:45' }),
		headers: new Headers({
			'cache-control': 'max-age=3600',
		}),
	});

	return [inputs, [['https://11.0.0.1:45' as const, { Host: '11.0.0.1:45' }]]];
}

function spec_3_1__2(): [INPUT[], OUTPUT[]] {
	const inputs = ['example_spec_3_1__2.com'];

	stubs.resolveHostname.resolves('[::1]');

	stubs.fetch.resolves({
		ok: true,
		json: () => Promise.resolve({ 'm.server': '[::1]:45' }),
	});

	return [inputs, [['https://[::1]:45' as const, { Host: '[::1]:45' }]]];
}

/* 3.2. If <delegated_hostname> is not an IP literal, and <delegated_port> is present, an IP address is discovered by looking up CNAME, AAAA or A records for <delegated_hostname>. The resulting IP address is used, alongside the <delegated_port>. Requests must be made with a Host header of <delegated_hostname>:<delegated_port>. The target server must present a valid certificate for <delegated_hostname>.
 */
function spec_3_2(): [INPUT[], OUTPUT[]] {
	const inputs = ['example_spec_3_2.com'];

	stubs.resolveHostname.reset();

	// for some reason onFirstCall and onSecondCall is not working
	stubs.resolveHostname.callsFake((hostname: string) => {
		if (hostname === 'example_spec_3_2.com') {
			return Promise.resolve('11.0.0.1');
		}

		if (hostname === 'example2_spec_3_2.com') {
			return Promise.resolve('[::1]');
		}
	});

	stubs.fetch.resolves({
		ok: true,
		json: () => Promise.resolve({ 'm.server': 'example2_spec_3_2.com:45' }), // delegatedPort is present
	});

	return [inputs, [['https://[::1]:45' as const, { Host: 'example2_spec_3_2.com:45' }]]];
}

/* If <delegated_hostname> is not an IP literal and no <delegated_port> is present, an SRV record is looked up for _matrix-fed._tcp.<delegated_hostname>. This may result in another hostname (to be resolved using AAAA or A records) and port. Requests should be made to the resolved IP address and port with a Host header containing the <delegated_hostname>. The target server must present a valid certificate for <delegated_hostname>.*/
function spec_3_3__1(): [INPUT[], OUTPUT[]] {
	const inputs = ['example_spec_3_3__1.com'];

	stubs.resolveHostname.resolves('11.0.0.1');

	stubs.fetch.resolves({
		ok: true,
		json: () => Promise.resolve({ 'm.server': 'example2_spec_3_3__1.com' }), // no delegatedPort is present, delegatedHostname is present and not ip
	});

	stubs.resolveSrv.resolves([{ name: '::1', port: 45 }]);

	return [inputs, [['https://[::1]:45' as const, { Host: 'example2_spec_3_3__1.com' }]]];
}

function spec_3_3__2(): [INPUT[], OUTPUT[]] {
	const inputs = ['example_spec_3_3__2.com'];

	stubs.resolveHostname.callsFake((name) => {
		if (name === 'exmaple_spec_3_3__2.com') return '11.0.0.1';

		if (name === 'example3_spec_3_3__2.com') return '[::1]';
	});

	stubs.fetch.resolves({
		ok: true,
		json: () => Promise.resolve({ 'm.server': 'example2_spec_3_3__2.com' }), // no delegatedPort is present, delegatedHostname is present and not ip
	});

	stubs.resolveSrv.resolves([{ name: 'example3_spec_3_3__2.com', port: 45 }]); // another hostname
	// now should do another resolveHostname

	return [inputs, [['https://[::1]:45' as const, { Host: 'example2_spec_3_3__2.com' }]]];
}

/* If the /.well-known request returned an error response, and no SRV records were found, an IP address is resolved using CNAME, AAAA and A records. Requests are made to the resolved IP address using port 8448 and a Host header containing the <hostname>. The target server must present a valid certificate for <hostname>. */
function spec_3_4__1(): [INPUT[], OUTPUT[]] {
	const inputs = ['example_spec_3_4__1.com'];

	stubs.resolveHostname.resolves('11.0.0.1');

	// wellknown no
	stubs.fetch.resolves({
		ok: false,
	});

	// srv no
	stubs.resolveSrv.resolves([]);

	return [inputs, [['https://11.0.0.1:8448' as const, { Host: 'example_spec_3_4__1.com' }]]];
}

async function runTest(inputs: INPUT[], outputs: OUTPUT[]) {
	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i];
		const output = outputs[i];

		// eslint-disable-next-line no-await-in-loop
		const [address, headers] = await getHomeserverFinalAddress(input);

		expect(address).toBe(output[0]);
		expect(headers).toEqual(output[1]);
	}
}

describe('_URL', () => {
	it('should mention port if specified even if standard port is used, unlike node:url', () => {
		const url = new _URL('https://example.com:443');
		expect(url.port).toBe('443');
		expect(url.origin).toBe('https://example.com');
	});

	it('should not mention port if not specified, like node:url', () => {
		const url = new _URL('https://example.com');
		expect(url.port).toBe('');
		expect(url.origin).toBe('https://example.com');
	});

	it('should parse url without protocol part', () => {
		const url = new _URL('example.com');
		expect(url.origin).toBe('https://example.com');
	});
});

describe('[Server Discovery 2.1 - resolve final address] https://spec.matrix.org/v1.12/server-server-api/#resolving-server-names', () => {
	it('2.1.1 (ipv4)', async () => {
		return runTest(...spec_1__1());
	});
	it('2.1.1 (ipv6)', async () => {
		return runTest(...spec_1__2());
	});
	it('2.1.2 (ipv4)', async () => {
		return runTest(...spec_2__1());
	});
	it('2.1.2 (ipv6)', async () => {
		return runTest(...spec_2__2());
	});
	it('3.1.1 (well-known delegation - ip4)', async () => {
		return runTest(...spec_3_1__1());
	});
	it('3.1.1 (well-known delegation - ip6)', async () => {
		return runTest(...spec_3_1__2());
	});
	it('3.2.1 (well-known delegation)', async () => {
		return runTest(...spec_3_2());
	});
	it('3.3.1 (well-known delegation)', async () => {
		return runTest(...spec_3_3__1());
	});
	it('3.3.2 (well-known delegation)', async () => {
		return runTest(...spec_3_3__2());
	});
	it('3.4.1 (well-known delegation - no wellknown, no srv)', async () => {
		return runTest(...spec_3_4__1());
	});
});
