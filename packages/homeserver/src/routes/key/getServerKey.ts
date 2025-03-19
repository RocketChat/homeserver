import { Elysia, t } from "elysia";
import { toUnpaddedBase64 } from "../../binaryData";
import { KeysDTO, ServerKeysDTO } from "../../dto";
import { signJson } from "../../signJson";
import { isConfigContext } from "../../plugins/isConfigContext";
import { isKeysContext } from "../../plugins/isKeysContext";

export const getServerKeyRoute = new Elysia()
	.get(
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
				async (json, signingKey) =>
					signJson(await json, signingKey, config.name),
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
	)
	.post(
		"/query",
		async (context) => {
			if (!isKeysContext(context)) {
				throw new Error("No keys context");
			}

			const { keys } = context;

			console.log({
				msg: "request",
				endpoint: "/_matrix/key/v2/query",
				body: context.body,
				query: context.query,
			});

			const keysResult = await keys?.query(context.body);

			console.log({
				msg: "response",
				endpoint: "/_matrix/key/v2/query",
				value: keysResult,
			});

			return keysResult;
		},
		{
			body: t.Object({
				server_keys: t.Record(
					t.String(),
					t.Record(
						t.String(),
						t.Object({
							minimum_valid_until_ts: t.Integer({
								format: "int64",
								description:
									"A millisecond POSIX timestamp in milliseconds indicating when the returned certificates will need to be valid until to be useful to the requesting server.",
								examples: [1532645052628],
							}),
						}),
					),
				),
			}),
			// response: ServerKeysDTO,
		},
	);
