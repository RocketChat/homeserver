import crypto from 'crypto';

import { encodeCanonicalJson, signJson } from "./signJson";
import { toUnpaddedBase64 } from './binaryData';

export async function authorizationHeaders<T extends object>(
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

export async function signRequest<T extends object>(
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

export function computeHash<T extends object>(content: T): T & { hashes: { sha256: string } } {
  // remove the fields that are not part of the hash
  const {
    age_ts,
    unsigned,
    signatures,
    hashes,
    outlier,
    destinations,
    ...toHash
  } = content as any;

  return {
    ...content,
    hashes: {
      sha256: toUnpaddedBase64(crypto.createHash("sha256").update(encodeCanonicalJson(toHash)).digest()),
    }
  }
}
