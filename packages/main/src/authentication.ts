import crypto from 'crypto';

import { signJson } from "./signJson";

export async function authorizationHeaders<T extends Object>(
  origin: string,
  signingKey: {
    algorithm: string;
    version: string;
    sign(data: Uint8Array): Promise<Uint8Array>;
  },
  destination: string,
  method: string,
  uri: string,
  content?: T
): Promise<string> {
  const signedJson = await signRequest(
    origin,
    signingKey,
    destination,
    method,
    uri,
    content
  );

  const key = `${signingKey.algorithm}:${signingKey.version}`;
  const signed = signedJson.signatures[origin][key];

  return `X-Matrix origin="${origin}",destination="${destination}",key="${key}",sig="${signed}"`;
}

export async function signRequest<T extends Object>(
  origin: string,
  signingKey: {
    algorithm: string;
    version: string;
    sign(data: Uint8Array): Promise<Uint8Array>;
  },
  destination: string,
  method: string,
  uri: string,
  content?: T
) {
  const signedJson = await signJson(
    {
      method,
      uri,
      origin,
      destination,
      ...(content && { content }),
      signatures: {},
    },
    signingKey,
    origin
  );

  return signedJson;
}

export function computeHash<T>(content: T): T & { hashes: { sha256: string } } {
  // event_dict.pop("age_ts", None)
  // event_dict.pop("unsigned", None)
  // event_dict.pop("signatures", None)
  // event_dict.pop("hashes", None)
  // event_dict.pop("outlier", None)
  // event_dict.pop("destinations", None)

  return {
    ...content,
    hashes: {
      sha256: crypto.createHash("sha256").update(JSON.stringify(content)).digest("base64"),
    }
  }
}
