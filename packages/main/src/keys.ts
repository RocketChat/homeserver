import { Config } from "./config";

// TODO: make it compatible with synapse

async function generateKeyPairs(algorithm = "Ed25519", version = "0") {
  // Generate an Ed25519 key pair
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true, // Extractable
    ["sign", "verify"]
  );

  // Encode the private key to Base64

  return [
    {
      version,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      base64PublicKey: encodePublicKeyToBase64(keyPair.publicKey),
      base64PrivateKey: encodePrivateKeyToBase64(keyPair.privateKey),
      algorithm,
    },
  ];
}

async function storeKeyPairs(
  keyPairs: {
    algorithm: string;
    version: string;
    publicKey: CryptoKey;
    privateKey: CryptoKey;
  }[],
  path: string
) {
  for await (const keyPair of keyPairs) {
    await Bun.write(
      path,
      `${keyPair.algorithm} ${keyPair.version} ${await encodePrivateKeyToBase64(
        keyPair.privateKey
      )} ${await encodePublicKeyToBase64(keyPair.publicKey)}`
    );
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64); // Decode Base64 to binary string
  const byteArray = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    byteArray[i] = binary.charCodeAt(i);
  }
  return byteArray.buffer;
}

async function encodePrivateKeyToBase64(
  privateKey: CryptoKey
): Promise<string> {
  // Export the private key in PKCS8 format
  const exportedKey = await crypto.subtle.exportKey("pkcs8", privateKey);

  // Convert the ArrayBuffer to a Base64 string
  return arrayBufferToBase64(exportedKey);
}

async function encodePublicKeyToBase64(cryptoKey: CryptoKey): Promise<string> {
  // Export the public key to raw format (ArrayBuffer)
  const exportedKey = await crypto.subtle.exportKey("spki", cryptoKey);

  // Convert the Uint8Array to a Base64 string
  return arrayBufferToBase64(exportedKey);
}

// Utility function to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer);
  let binary = "";
  byteArray.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary); // Encode the binary string to Base64
}

async function getRestoreKeys(config: { signingKeyPath: string }) {
  const [algorithm, version, base64PrivateKey, base64PublicKey] = (
    await Bun.file(config.signingKeyPath).text()
  ).split(" ");

  // Convert Base64 string to an ArrayBuffer

  // Import the private key from PKCS8 format
  return [
    {
      algorithm,
      version,
      privateKey: await crypto.subtle.importKey(
        "pkcs8", // Format of the key
        await base64ToArrayBuffer(base64PrivateKey),
        {
          name: "Ed25519", // Algorithm name
        },
        true, // Extractable (true/false)
        ["sign"] // Key usages
      ),
      publicKey: await crypto.subtle.importKey(
        "spki", // Format of the key
        await base64ToArrayBuffer(base64PublicKey),
        {
          name: "Ed25519", // Algorithm name
        },
        true, // Extractable (true/false)
        ["verify"] // Key usages
      ),
      base64PublicKey,
    },
  ];
}

export const getKeyPair = async (config: {
  signingKeyPath: string;
}): Promise<
  {
    algorithm: string;
    version: string;
    publicKey: CryptoKey;
    privateKey: CryptoKey;
  }[]
> => {
  const { signingKeyPath } = config;
  if (!(await Bun.file(signingKeyPath).exists())) {
    const result = await generateKeyPairs();
    await storeKeyPairs(result, signingKeyPath);
    return result;
  }

  return getRestoreKeys(config);
};
