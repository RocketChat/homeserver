export type KeyV2ServerResponse = {
  // still valid for signing events
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
  // only federation requests
  verify_keys: Record<
    string, // keyAlgo:algoVersion => KeyId
    {
      key: string; // base64 encoded
    }
  >;
};

export type ServerKey = {
  serverName: string;
  keys: {
    [keyId: string]: {
      key: string;
      _createdAt: Date;
      expiresAt: number;
      expiredTs?: number;
    };
  };
  // should this save the responses here?
  // does the spec dictate the signatures
};
