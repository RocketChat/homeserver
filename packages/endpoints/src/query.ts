import typia, { tags } from "typia";

// https://spec.matrix.org/v1.10/server-server-api/#post_matrixkeyv2query

interface Body {
	server_keys: Record<
		string,
		{
			minimum_valid_until_ts: number;
		}
	>;
}

interface Response {
	server_keys: {
		old_verify_keys: Record<
			string,
			{
				expired_ts: number;
				key: string;
			}
		>;
		server_name: string;
		signatures: Record<string, Record<string, string>>;
		valid_until_ts: number;
		verify_keys: Record<
			string,
			{
				key: string;
			}
		>;
	}[];
}
declare module "./endpoints" {
	interface Endpoints {
		"/v2/query": {
			POST: {
				description: "Query for keys from multiple servers in a batch format. The receiving (notary) server must sign the keys returned by the queried servers.";
				auth: false;
				rateLimit: false;
				body: Body;
				response: Response;
			};
		};
		"/v2/query/:serverName": {
			GET: {
				description: "Query for keys from a single server. The receiving (notary) server must sign the keys returned by the queried server.";
				auth: false;
				rateLimit: false;
				query: {
					minimum_valid_until_ts: number;
				};
				response: Response;
			};
		};
	}
}
