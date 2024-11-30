import nacl from "tweetnacl";

export async function signJson<
  T extends {
    signatures?: Record<string, Record<string, string>>;
    unsigned?: any;
  }
>(
  jsonObject: T,
  signingKey: {
    algorithm: string;
    version: string;
    sign(data: string): Promise<string>;
  },
  signingName: string
): Promise<
  T & {
    signatures: Record<string, Record<string, string>>;
  }
> {
  const keyId = `${signingKey.algorithm}:${signingKey.version}`;
  const { signatures = {}, unsigned, ...rest } = jsonObject;

  const signed = await signingKey.sign(encodeCanonicalJson(rest));
  // const signatureBase64 = encodeBase64(signed);

  const signature = signatures[signingName] || {};

  return {
    ...rest,
    signatures: {
      ...signatures,
      [signingName]: {
        ...signature,
        [keyId]: signed,
      },
    },
    ...(unsigned && { unsigned }),
  };
}

export function encodeCanonicalJson(jsonObject: any): string {
  return JSON.stringify(jsonObject);
}

export function encodeBase64(buffer: Uint8Array | string): string {
  const bufferToEncode =
    typeof buffer === "string" ? new TextEncoder().encode(buffer) : buffer;
  return Buffer.from(bufferToEncode).toString("base64");
}

export async function signText(data: string, signingKey: Uint8Array) {
  return nacl.sign(new TextEncoder().encode(data), signingKey);
}
