import { resolveHostAddressByServerName } from '../server-discovery/discovery';
import type { SigningKey } from '../types';
import { extractURIfromURL } from '../url';
import { authorizationHeaders, computeAndMergeHash } from './authentication';
import { signJson } from './signJson';

export const makeRequest = async <T = Record<string, unknown>>({
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
	body?: Record<string, unknown>;
	signingName: string;
	options?: Record<string, unknown>;
	queryString?: string;
}): Promise<T> => {
	const { address, headers } = await resolveHostAddressByServerName(domain, signingName);
	const url = new URL(`https://${address}${uri}`);
	if (queryString) {
		url.search = queryString;
	}

	const requestOptions: RequestInit = {
		...options,
		method,
		headers,
	};

	if (body) {
		requestOptions.body = JSON.stringify(body);
	}

	const response = await fetch(url.toString(), requestOptions);

	return response.json() as Promise<T>;
};

export const makeUnsignedRequest = async <T = Record<string, unknown>>({
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
	body?: Record<string, unknown>;
	options?: Record<string, unknown>;
	signingKey: SigningKey;
	signingName: string;
	queryString?: string;
}): Promise<T> => {
	const auth = await authorizationHeaders<Record<string, unknown>>(signingName, signingKey, domain, method, uri, body);

	const { address, headers } = await resolveHostAddressByServerName(domain, signingName);
	const url = new URL(`https://${address}${uri}`);
	if (queryString) {
		url.search = queryString;
	}

	const requestOptions: RequestInit = {
		...options,
		method,
		headers: {
			'Authorization': auth,
			...headers,
			'content-type': 'application/json',
		},
	};

	if (body) {
		requestOptions.body = JSON.stringify(body);
	}

	const response = await fetch(url.toString(), requestOptions);

	return response.json() as Promise<T>;
};
