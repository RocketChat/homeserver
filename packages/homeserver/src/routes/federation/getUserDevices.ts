import Elysia from "elysia";

export const getUserDevicesRoute = new Elysia()
	// not tested
	.get(
		"/user/devices/:userId",
		({ params }) => {
			return {
				user_id: params.userId,
				stream_id: 1,
				devices: [],
			};
		},
		{
			detail: {
				security: [
					{
						matrixAuth: [],
					},
				],
			},
		},
	);
