import nacl from "tweetnacl";
import { toBinaryData, toUnpaddedBase64 } from "./binaryData";

export async function signJson<
  T extends Object & {
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

  console.log("encodeCanonicalJson ->", data);

  const signed = await signingKey.sign(toBinaryData(data));

  const signature = signatures[signingName] || {};

  Object.assign(signatures, {
    [signingName]: {
      ...signature,
      [keyId]: toUnpaddedBase64(signed),
    },
  });

  Object.assign(jsonObject, { signatures });

  return jsonObject as T & {
    signatures: Record<string, Record<string, string>>;
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

export async function signText(
  data: string | Uint8Array,
  signingKey: Uint8Array
) {
  if (typeof data === "string") {
    data = toBinaryData(data);
  }
  return nacl.sign.detached(data, signingKey);
}
