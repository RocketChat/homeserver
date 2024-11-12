import typia, { tags } from "typia";

// // https://spec.matrix.org/v1.9/server-server-api/#get_matrixkeyv2server

interface Response {
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

interface Query {}

declare module "./endpoints" {
  interface Endpoints {
    "/v2/server": {
      GET: {
        description: "Gets the homeserver’s published signing keys. The homeserver may have any number of active keys and may have a number of old keys.";
        auth: false;
        rateLimit: false;
        query: Query;
        response: Response;
      };
    };
    "/v2/server/": {
      GET: {
        description: "Gets the homeserver’s published signing keys. The homeserver may have any number of active keys and may have a number of old keys.";
        auth: false;
        rateLimit: false;
        query: Query;
        response: Response;
      };
    };
    "/v2/server/{keyID}": {
      GET: {
        description: "Gets the homeserver’s published signing keys. The homeserver may have any number of active keys and may have a number of old keys.";
        auth: false;
        rateLimit: false;
        query: Query;
        response: Response;
      };
    };
  }
}
