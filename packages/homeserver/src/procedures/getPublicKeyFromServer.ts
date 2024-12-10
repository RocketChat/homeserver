export const makeGetPublicKeyFromServerProcedure = (
	getFromLocal: (origin: string, key: string) => Promise<string | undefined>,
	getFromOrigin: (origin: string) => Promise<{ key: string; validUntil: number }>,
	store: (origin: string, key: string, value: string, validUntil: number) => Promise<void>,
) => {
	return async (origin: string, key: string) => {
		const localPublicKey = await getFromLocal(origin, key);
		console.log({ localPublicKey })
		if (localPublicKey) {
			return localPublicKey;
		}

		const { key: remotePublicKey, validUntil } = await getFromOrigin(origin);
		if (remotePublicKey) {
			await store(origin, key, remotePublicKey, validUntil);
			return remotePublicKey;
		}

		throw new Error("Public key not found");
	};
};
