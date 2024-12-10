import type { HomeServerRoutes } from "./app";
import { authorizationHeaders, computeHash } from "./authentication";
import { extractURIfromURL } from "./helpers/url";
import type { SigningKey } from "./keys";

import { signJson } from "./signJson";

type getAllResponsesByMethod<
	T extends HomeServerRoutes,
	M extends HomeServerRoutes["method"],
> = T extends { method: M } ? T : never;

type getAllResponsesByPath<
	T extends HomeServerRoutes,
	M extends HomeServerRoutes["method"],
	P extends HomeServerRoutes["path"],
> = T extends { method: M; path: P } ? T : never;

export const makeSignedRequest = async <
	M extends HomeServerRoutes["method"],
	U extends getAllResponsesByMethod<HomeServerRoutes, M>["path"],
	B extends getAllResponsesByPath<HomeServerRoutes, M, U>["body"],
>({
	method,
	domain,
	uri,
	body,
	options = {},
	signingKey,
	signingName,
	queryString,
}: (B extends Record<string, unknown> ? { body: B } : { body?: never }) & {
	method: M;
	domain: string;
	uri: U;
	options?: Record<string, any>;
	signingKey: SigningKey;
	signingName: string;
	queryString?: string;
}) => {
	const url = new URL(`https://${domain}${uri}`);
	if (queryString) {
		url.search = queryString;
	}
	const signedBody =
		body && (await signJson(computeHash({ ...body, signatures: {} }), signingKey, signingName));

	console.log("body ->", method, domain, url.toString(), signedBody);

	const auth = await authorizationHeaders(
		signingName,
		signingKey,
		domain,
		method,
		extractURIfromURL(url),
		signedBody,
	);

	console.log("auth ->", method, domain, uri, auth);

	const response = await fetch(url.toString(), {
		...options,
		...(body && { body: JSON.stringify(signedBody) }),
		method,
		...(queryString && { search: queryString }),
		headers: {
			Authorization: auth,
		},
	});

	return response.json() as Promise<
		getAllResponsesByPath<HomeServerRoutes, M, U>["response"][200]
	>;
};

export const makeRequest = async <
	M extends HomeServerRoutes["method"],
	U extends getAllResponsesByMethod<HomeServerRoutes, M>["path"],
	B extends getAllResponsesByPath<HomeServerRoutes, M, U>["body"],
>({
	method,
	domain,
	uri,
	body,
	options = {},
	queryString,
}: (B extends Record<string, unknown> ? { body: B } : { body?: never }) & {
	method: M;
	domain: string;
	uri: U;
	options?: Record<string, any>;
	queryString?: string;
}) => {
	const url = new URL(`https://${domain}${uri}`);
	if (queryString) {
		url.search = queryString;
	}

	const response = await fetch(url.toString(), {
		...options,
		...(body && { body: JSON.stringify(body) }),
		method,
		...(queryString && { search: queryString }),
	});

	return response.json() as Promise<
		getAllResponsesByPath<HomeServerRoutes, M, U>["response"][200]
	>;
};

export const makeUnsignedRequest = async <
	M extends HomeServerRoutes["method"],
	U extends getAllResponsesByMethod<HomeServerRoutes, M>["path"],
	R extends getAllResponsesByPath<HomeServerRoutes, M, U>["response"][200],
	B extends getAllResponsesByPath<HomeServerRoutes, M, U>["body"],
>({
	method,
	domain,
	uri,
	options = {},
	signingKey,
	signingName,
	queryString,
}: {
	method: M;
	domain: string;
	uri: U;
	body: B;
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
		options.body,
	);

	const url = new URL(`https://${domain}${uri}`);
	if (queryString) {
		url.search = queryString;
	}
	const response = await fetch(url.toString(), {
		...options,
		...(options.body && { body: JSON.stringify(options.body) }),
		method,
		headers: {
			Authorization: auth,
		},
	});

	return response.json() as Promise<R>;
};
