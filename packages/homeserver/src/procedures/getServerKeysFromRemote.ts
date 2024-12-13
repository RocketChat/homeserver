import type { Response as ServerKeysResponse } from '@hs/core/src/server';
import type { Server } from "../plugins/mongodb";
import type { WithId } from 'mongodb';

export const makeGetServerKeysFromServerProcedure = (
	getFromLocal: (origin: string) => Promise<WithId<Server> | null>,
	getFromOrigin: (origin: string) => Promise<ServerKeysResponse>,
	store: (origin: string, serverKeys: Omit<Server, '_id' | 'name'>) => Promise<void>,
) => {
	return async (origin: string) => {
		try {
			const localServerKeys = await getFromLocal(origin);
			if (localServerKeys) {
				return localServerKeys;
			}

			const result = await getFromOrigin(origin);
			if (result) {
				await store(origin, result);
				return result;
			}
		} catch {
			return;
		}

		throw new Error("Keys not found");
	};
};
