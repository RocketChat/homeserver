import { getKeyPair } from "homeserver";
import type { Config } from "homeserver/src/plugins/config";
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
		signingKey: result,
		name: content.name,
		path: CONFIG_FOLDER,
		signingKeyPath,
	};
};

export const config = await getConfig();
