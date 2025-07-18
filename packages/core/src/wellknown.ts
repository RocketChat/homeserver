// https://spec.matrix.org/v1.9/server-server-api/#getwell-knownmatrixserver

interface Response {
	server: {
		name: string;
		version: string;
	};
}

type Query = object;

export interface WellKnownEndpoints {
	'/.well-known/matrix/server': {
		GET: {
			auth: false;
			rateLimit: false;
			query: Query;
			response: Response;
		};
	};
}
