import nacl from "tweetnacl";

// TODO: make it compatible with synapse

async function generateKeyPairs(
  seed: Uint8Array,
  algorithm = "ed25519",
  version = "0"
) {
  // Generate an Ed25519 key pair
  const keyPair = await nacl.sign.keyPair.fromSeed(seed);

  // Encode the private key to Base64

  return [
    {
      version,
      privateKey: keyPair.secretKey,
      publicKey: keyPair.publicKey,
      algorithm,
    },
  ];
}

async function storeKeyPairs(
  seeds: {
    algorithm: string;
    version: string;
    seed: Uint8Array;
  }[],
  path: string
) {
  for await (const keyPair of seeds) {
    await Bun.write(
      path,
      `${keyPair.algorithm} ${keyPair.version} ${Buffer.from(
        keyPair.seed
      ).toString("base64").replace(/=+$/, "")}`
    );
  }
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
  const [algorithm, version, seed] = (
    await Bun.file(config.signingKeyPath).text()
  ).trim().split(" ");

  // Convert Base64 string to an ArrayBuffer

  // Import the private key from PKCS8 format
  return generateKeyPairs(
    Uint8Array.from(atob(seed), (c) => c.charCodeAt(0)),
    algorithm,
    version
  );
}

export const getKeyPair = async (config: {
  signingKeyPath: string;
}): Promise<
  {
    algorithm: string;
    version: string;
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  }[]
> => {
  const { signingKeyPath } = config;
  if (!(await Bun.file(signingKeyPath).exists())) {
    const seed = nacl.randomBytes(32);
    await storeKeyPairs(
      [
        {
          algorithm: "ed25519",
          version: "0",
          seed,
        },
      ],
      signingKeyPath
    );
    const result = await generateKeyPairs(seed);
    return result;
  }

  return getRestoreKeys(config);
};
