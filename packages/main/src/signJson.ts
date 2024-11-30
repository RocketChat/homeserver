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
    sign(data: Uint8Array): Promise<Uint8Array>;
  },
  signingName: string
): Promise<
  T & {
    signatures: Record<string, Record<string, string>>;
  }
> {
  const keyId = `${signingKey.algorithm}:${signingKey.version}`;
  const { signatures = {}, unsigned, ...rest } = jsonObject;
  const data = encodeCanonicalJson(rest);
  const signed = await signingKey.sign(new TextEncoder().encode(data));

  const signature = signatures[signingName] || {};

  return {
    ...rest,
    signatures: {
      ...signatures,
      [signingName]: {
        ...signature,
        [keyId]: Buffer.from(signed).toString("base64"),
      },
    },
    ...(unsigned && { unsigned }),
  };
}

export function encodeCanonicalJson(value: any): string {
  if (value === null || typeof value !== "object") {
    // Handle primitive types and null
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    // Handle arrays recursively
    const serializedArray = value.map(encodeCanonicalJson);
    return `[${serializedArray.join(",")}]`;
  }

  // Handle objects: sort keys lexicographically
  const sortedKeys = Object.keys(value).sort();
  const serializedEntries = sortedKeys.map(
    (key) => `"${key}":${encodeCanonicalJson(value[key])}`
  );
  return `{${serializedEntries.join(",")}}`;
}

export function encodeBase64(buffer: Uint8Array | string): string {
  const bufferToEncode =
    typeof buffer === "string" ? new TextEncoder().encode(buffer) : buffer;
  return Buffer.from(bufferToEncode).toString("base64");
}

export async function signText(
  data: string | Uint8Array,
  signingKey: Uint8Array
) {
  if (typeof data === "string") {
    data = new TextEncoder().encode(data);
  }
  return nacl.sign.detached(data, signingKey);
}
