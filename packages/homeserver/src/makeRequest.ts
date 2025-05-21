import { authorizationHeaders, computeAndMergeHash } from "./authentication";
import { resolveHostAddressByServerName } from "./helpers/server-discovery/discovery";
import { extractURIfromURL } from "./helpers/url";
import type { SigningKey } from "./keys";

import { signJson } from "./signJson";

export const makeSignedRequest = async({
	method,
	domain,
	uri,
	body,
	options = {},
	signingKey,
	signingName,
	queryString,
}: {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	domain: string;
	uri: string;
	body?: unknown;
	options?: Record<string, any>;
	signingKey: SigningKey;
	signingName: string;
	queryString?: string;
}) => {
	const { address, headers } = await resolveHostAddressByServerName(
		domain,
		signingName,
	);
	const url = new URL(`https://${address}${uri}`);
	if (queryString) {
		url.search = queryString;
	}
	const signedBody =
		body &&
		(await signJson(
			computeAndMergeHash({ ...body, signatures: {} }),
			signingKey,
			signingName,
		));

	console.log("body ->", method, domain, url.toString(), signedBody);

	const auth = await authorizationHeaders(
		signingName,
		signingKey,
		domain,
		method,
		extractURIfromURL(url),
		signedBody as any,
	);

	console.log("auth ->", method, domain, uri, auth);

	const response = await fetch(url.toString(), {
		...options,
		...(body && { body: JSON.stringify(signedBody) }) as any,
		method,
		...(queryString && { search: queryString }),
		headers: {
			Authorization: auth,
			...headers,
		},
	});

	return response.json() as Promise<unknown>;
};

export const makeRequest = async({
	method,
	domain,
	uri,
	body,
	signingName,
	options = {},
	queryString,
}: {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	domain: string;
	uri: string;
	body?: unknown;
	signingName: string;
	options?: Record<string, any>;
	queryString?: string;
}) => {
	const { address, headers } = await resolveHostAddressByServerName(
		domain,
		signingName,
	);
	const url = new URL(`https://${address}${uri}`);
	if (queryString) {
		url.search = queryString;
	}

	const response = await fetch(url.toString(), {
		...options,
		...(body && { body: JSON.stringify(body) }) as any,
		method,
		...(queryString && { search: queryString }),
		headers,
	});

	return response.json() as Promise<unknown>;
};

export const makeUnsignedRequest = async({
	method,
	domain,
	uri,
	body,
	options = {},
	signingKey,
	signingName,
	queryString,
}: {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	domain: string;
	uri: string;
	body?: unknown;
	options?: Record<string, any>;
	signingKey: SigningKey;
	signingName: string;
	queryString?: string;
}) => {
	const auth = await authorizationHeaders(
		signingName,
		signingKey,
		domain,
		method,
		uri,
		body as any,
	);

	const { address, headers } = await resolveHostAddressByServerName(
		domain,
		signingName,
	);
	const url = new URL(`https://${address}${uri}`);
	if (queryString) {
		url.search = queryString;
	}
	const response = await fetch(url.toString(), {
		...options,
		...(body && { body: JSON.stringify(body) }) as any,
		method,
		headers: {
			Authorization: auth,
			...headers,
			'content-type': 'application/json',
		},
	});

	return response.json() as Promise<unknown>;
};
