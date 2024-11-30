import { JWT } from "node-jsonwebtoken";

export async function authorizationHeaders(
  originName: string,
  originSigningKey: string,
  destinationName: string,
  requestMethod: string,
  requestTarget: string,
  content?: any
): Promise<string> {
  const requestJson = {
    method: requestMethod,
    uri: requestTarget,
    origin: originName,
    destination: destinationName,
    ...(content && { content: content }),
  };

  const jwt = new JWT(originSigningKey);

  const algorithm = "ed25519";
  const algorithmVersion = "0";
  const key = `${algorithm}:${algorithmVersion}`;

  const signedJson = await jwt.sign(requestJson, { algorithm });

  return `X-Matrix origin="${originName}",destination="${destinationName}",key="${key}",sig="${signedJson}"`;
}
