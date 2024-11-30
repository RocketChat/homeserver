import { signJson } from "./signJson";

export async function authorizationHeaders<T extends Object>(
  originName: string,
  signingKey: {
    algorithm: string;
    version: string;
    sign(data: string): Promise<string>;
  },
  destinationName: string,
  requestMethod: string,
  requestTarget: string,
  content?: T
): Promise<string> {
  const requestJson = {
    method: requestMethod,
    uri: requestTarget,
    origin: originName,
    destination: destinationName,
    ...(content && { content }),
  };


  const signedJson = await signJson({
    ...requestJson,
    signatures: {},
  }, signingKey, originName);

  const key = `${signingKey.algorithm}:${signingKey.version}`;
  const signed = signedJson.signatures[originName][key];

  return `X-Matrix origin="${originName}",destination="${destinationName}",key="${key}",sig="${signed}"`;
}
