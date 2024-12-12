import Elysia, { t } from "elysia";

export const queryUserEncryptionKeysRoute = new Elysia().post(
	"/user/keys/query",
	({ body }) => {
		const keys = Object.keys(body.device_keys).reduce((v, cur) => {
			v[cur] = "unknown_key";

			return v;
		}, {} as any);

		return {
			device_keys: keys,
		};
	},
	{
		body: t.Object({
			device_keys: t.Any(),
		}),
		response: t.Object({
			device_keys: t.Any(),
		}),
		detail: {
			security: [
				{
					matrixAuth: [],
				},
			],
		},
	},
);
