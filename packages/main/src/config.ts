import { getKeyPair } from "./keys";
import { signText } from "./signJson";

export interface Config {
  path: string;
  signingKeyPath: string;
  port: number;
  signingKey: {
    algorithm: string;
    version: string;
    publicKey: Uint8Array;
    sign(data: Uint8Array): Promise<Uint8Array>;
  }[];
  name: string;
  version: string;
}

const { CONFIG_FOLDER = "." } = process.env;

const getConfig = async (): Promise<Config> => {
  // read info
  const file = Bun.file(`${CONFIG_FOLDER}/config.json`);

  if (!file.exists) {
    throw new Error("Config file not found");
  }
  const content = await file.json();

  if (!content.name) {
    throw new Error("Config file is missing the name property");
  }

  if (content.signingKey) {
    return content;
  }

  const { signingKeyPath = `${CONFIG_FOLDER}/${content.name}.signing.key` } =
    content;

  if (typeof signingKeyPath !== "string") {
    throw new Error("Config file is missing the signingKeyPath property");
  }

  const result = await getKeyPair({
    signingKeyPath,
  });

  return {
    ...content,
    signingKey: result.map((result) => ({
      ...result,

      sign(data: Uint8Array) {
        return signText(data, result.privateKey);
      },
    })),
    name: content.name,
    path: CONFIG_FOLDER,
    signingKeyPath,
  };
};

export const config = await getConfig();
