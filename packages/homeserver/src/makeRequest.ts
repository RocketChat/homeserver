import type { HomeServerRoutes } from "./app";
import { authorizationHeaders, computeHash } from "./authentication";
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

export const makeRequest = async <
	M extends HomeServerRoutes["method"],
	U extends getAllResponsesByMethod<HomeServerRoutes, M>["path"],
	R extends getAllResponsesByPath<HomeServerRoutes, M, U>["response"][200],
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
	options?: Record<string, any>;
	signingKey: SigningKey;
	signingName: string;
	queryString?: string;
}) => {
	const url = new URL(`https://${domain}${uri}`);
	if (queryString) {
		url.search = queryString;
	}
	const body =
		options.body &&
		(await signJson(
			computeHash({ ...options.body, signatures: {} }),
			signingKey,
			signingName,
		));

	console.log("body ->", method, domain, url.toString(), body);

	const auth = await authorizationHeaders(
		signingName,
		signingKey,
		domain,
		method,
		uri,
		body,
	);

	console.log("auth ->", method, domain, uri, auth);

	const response = await fetch(url.toString(), {
		...options,
		...(body && { body: JSON.stringify(body) }),
		method,
		...(queryString && { search: queryString }),
		headers: {
			Authorization: auth,
		},
	});

	return response.json() as Promise<R>;
};

export const makeUnsignedRequest = async <
	M extends HomeServerRoutes["method"],
	U extends getAllResponsesByMethod<HomeServerRoutes, M>["path"],
	R extends getAllResponsesByPath<HomeServerRoutes, M, U>["response"][200],
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
