export const makeGetPublicKeyFromServerProcedure = (
	getFromLocal: (origin: string, key: string) => Promise<string | undefined>,
	getFromOrigin: (origin: string) => Promise<string>,
	store: (origin: string, key: string, value: string) => Promise<void>,
) => {
	return async (origin: string, key: string) => {
		const localPublicKey = await getFromLocal(origin, key);
		if (localPublicKey) {
			return localPublicKey;
		}

		const remotePublicKey = await getFromOrigin(origin);
		if (remotePublicKey) {
			await store(origin, key, remotePublicKey);
			return remotePublicKey;
		}

		throw new Error("Public key not found");
	};
};
