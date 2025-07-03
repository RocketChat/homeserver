import type { SigningKey } from '../types';
// import { resolveHostAddressByServerName } from '@hs/homeserver';
import { extractURIfromURL } from '../url';
import { authorizationHeaders, computeAndMergeHash } from './authentication';
import { logger } from './logger';
import { signJson } from './signJson';

// Temporary function to resolve host address
const resolveHostAddressByServerName = async (
	serverName: string,
	_ownServerName: string,
): Promise<{ address: string; headers: { Host: string } }> => {
	return {
		address: `${serverName}:443`,
		headers: { Host: serverName },
	};
};

export const makeSignedRequest = async <T = Record<string, unknown>>({
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

	logger.debug('body ->', method, domain, url.toString(), signedBody);

	const auth = await authorizationHeaders(
		signingName,
		signingKey,
		domain,
		method,
		extractURIfromURL(url),
		signedBody as Record<string, unknown>,
	);

	logger.debug('auth ->', method, domain, uri, auth);

	const requestOptions: RequestInit = {
		...options,
		method,
		headers: {
			Authorization: auth,
			...headers,
		},
	};

	if (body && signedBody) {
		requestOptions.body = JSON.stringify(signedBody);
	}

	if (queryString) {
		url.search = queryString.startsWith('?') ? queryString : `?${queryString}`;
	}

	const response = await fetch(url.toString(), requestOptions);

	return response.json() as Promise<T>;
};

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
	const { address, headers } = await resolveHostAddressByServerName(
		domain,
		signingName,
	);
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
	const auth = await authorizationHeaders<Record<string, unknown>>(
		signingName,
		signingKey,
		domain,
		method,
		uri,
		body,
	);

	const { address, headers } = await resolveHostAddressByServerName(
		domain,
		signingName,
	);
	const url = new URL(`https://${address}${uri}`);
	if (queryString) {
		url.search = queryString;
	}

	const requestOptions: RequestInit = {
		...options,
		method,
		headers: {
			Authorization: auth,
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
