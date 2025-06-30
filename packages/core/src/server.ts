import typia, { tags } from 'typia';

// // https://spec.matrix.org/v1.9/server-server-api/#get_matrixkeyv2server

export interface ServerKey {
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
}

export type Query = object;
