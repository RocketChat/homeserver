import { authorizationHeaders, computeHash } from "./authentication";
import type { SigningKey } from "./keys";

import { signJson } from "./signJson";

export const makeRequest = async ({
	method,
	domain,
	uri,
	options = {},
	signingKey,
	signingName,
}: {
	method: string;
	domain: string;
	uri: string;
	options?: Record<string, any>;
	signingKey: SigningKey;
	signingName: string;
}) => {
	const body =
		options.body &&
		(await signJson(
			computeHash({ ...options.body, signatures: {} }),
			signingKey,
			signingName,
		));

	console.log("body ->", method, domain, uri, body);

	const auth = await authorizationHeaders(
		signingName,
		signingKey,
		domain,
		method,
		uri,
		body,
	);

	console.log("auth ->", method, domain, uri, auth);

	return fetch(`https://${domain}${uri}`, {
		...options,
		...(body && { body: JSON.stringify(body) }),
		method,
		headers: {
			Authorization: auth,
		},
	});
};

export const makeUnsignedRequest = async ({
	method,
	domain,
	uri,
	options = {},
	signingKey,
	signingName,
}: {
	method: string;
	domain: string;
	uri: string;
	options?: Record<string, any>;
	signingKey: SigningKey;
	signingName: string;
}) => {
	const auth = await authorizationHeaders(
		signingName,
		signingKey,
		domain,
		method,
		uri,
		options.body,
	);

	console.log("auth ->", auth);

	return fetch(`https://${domain}${uri}`, {
		...options,
		...(options.body && { body: JSON.stringify(options.body) }),
		method,
		headers: {
			Authorization: auth,
		},
	});
};
