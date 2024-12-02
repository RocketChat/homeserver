import { authorizationHeaders, computeHash } from "./authentication";
import { config } from "./config";
import { signJson } from "./signJson";

export const makeRequest = async ({
	method,
	domain,
	uri,
	options = {},
}: {
	method: string;
	domain: string;
	uri: string;
	options?: Record<string, any>;
}) => {
	const signingKey = config.signingKey[0];

	const body =
		options.body &&
		(await signJson(
			computeHash({ ...options.body, signatures: {} }),
			config.signingKey[0],
			config.name,
		));

	console.log("body ->", body);

	const auth = await authorizationHeaders(
		config.name,
		signingKey,
		domain,
		method,
		uri,
		body,
	);

	console.log("auth ->", auth);

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
}: {
	method: string;
	domain: string;
	uri: string;
	options?: Record<string, any>;
}) => {
	const signingKey = config.signingKey[0];

	const auth = await authorizationHeaders(
		config.name,
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
