import { Elysia } from "elysia";

import { toUnpaddedBase64 } from "../../binaryData";

import { KeysDTO } from "../../dto";
import { signJson } from "../../signJson";
import { isConfigContext } from "../../plugins/isConfigContext";

export const keyV2Endpoints = new Elysia({ prefix: "/_matrix/key/v2" }).get(
	"/server",

	async (context) => {
		if (!isConfigContext(context)) {
			throw new Error("No config context");
		}
		const { config } = context;
		const keys = Object.fromEntries(
			config.signingKey.map(({ algorithm, version, publicKey }) => [
				`${algorithm}:${version}`,
				{
					key: toUnpaddedBase64(publicKey),
				},
			]),
		);

		return config.signingKey.reduce(
			async (json, signingKey) => signJson(await json, signingKey, config.name),
			Promise.resolve({
				old_verify_keys: {},
				server_name: config.name,
				// 1 day
				signatures: {},
				valid_until_ts: new Date().getTime() + 60 * 60 * 24 * 1000,
				verify_keys: keys,
			}),
		);
	},
	{
		response: KeysDTO,
		detail: {
			description:
				"Gets the homeserver's published signing keys.\nThe homeserver may have any number of active keys and may have a\nnumber of old keys.\n\nIntermediate notary servers should cache a response for half of its\nlifetime to avoid serving a stale response. Originating servers should\navoid returning responses that expire in less than an hour to avoid\nrepeated requests for a certificate that is about to expire. Requesting\nservers should limit how frequently they query for certificates to\navoid flooding a server with requests.\n\nIf the server fails to respond to this request, intermediate notary\nservers should continue to return the last response they received\nfrom the server so that the signatures of old events can still be\nchecked.",
			operationId: "getServerKey",
		},
	},
);
