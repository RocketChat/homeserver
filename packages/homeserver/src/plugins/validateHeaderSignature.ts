import type { Context } from "elysia";
import {
	extractSignaturesFromHeader,
	validateAuthorizationHeader,
} from "../authentication";
import { isConfigContext } from "./isConfigContext";
import { isMongodbContext } from "./isMongodbContext";
import { makeGetServerKeysFromServerProcedure, getPublicKeyFromRemoteServer, extractKeyFromServerKeys } from "../procedures/getServerKeysFromRemote";
import { ForbiddenError, UnknownTokenError } from "../errors";
import { extractURIfromURL } from "../helpers/url";

export interface OriginOptions {
	/**
	 * If the API doesn't compliant with RFC6750
	 * The key for extracting the token is configurable
	 */
	extract: {
		/**
		 * Determined which fields to be identified as Bearer token
		 *
		 * @default access_token
		 */
		body?: string;
		/**
		 * Determined which fields to be identified as Bearer token
		 *
		 * @default access_token
		 */
		query?: string;
		/**
		 * Determined which type of Authentication should be Bearer token
		 *
		 * @default Bearer
		 */
		header?: string;
	};
}

export const validateHeaderSignature = async ({
	headers: { authorization },
	request,
	body,
	...context
}: Context) => {
	if (!isConfigContext(context)) {
		throw new Error("No config context");
	}
	if (!isMongodbContext(context)) {
		throw new Error("No mongodb context");
	}
	if (!authorization) {
		throw new UnknownTokenError("No authorization header");
	}

	try {
		const origin = extractSignaturesFromHeader(authorization);
		// TODO: not sure if we should throw an error if the origin is not the same as the config.name
		// or if we should just act as a proxy
		if (origin.destination !== context.config.name) {
			throw new Error("Invalid destination");
		}

		const getPublicKeyFromServer = makeGetServerKeysFromServerProcedure(
			context.mongo.getValidServerKeysFromLocal,
			() =>
				getPublicKeyFromRemoteServer(
					origin.origin,
					origin.destination,
					origin.key,
				),
			context.mongo.storeServerKeys,
		);

		const serverKeys = await getPublicKeyFromServer(origin.origin, origin.key);
		if (!serverKeys) {
			throw new Error('Could not retrieve the server keys to verify');
		}
		const publickey = extractKeyFromServerKeys(serverKeys.verify_keys, origin.key);
		const url = new URL(request.url);
		if (
			!(await validateAuthorizationHeader(
				origin.origin,
				publickey.key,
				origin.destination,
				request.method,
				extractURIfromURL(url),
				origin.signature,
				body as any,
			))
		) {
			throw new Error("Invalid signature");
		}
		// return {
		// 	get origin() {
		// 		return origin;
		// 	},
		// };
	} catch (error) {
		if (error instanceof ForbiddenError) {
			throw error;
		}
		console.log("ERROR->", error);
		if (error instanceof Error) {
			throw new UnknownTokenError(error.message);
		}
	}
};

export default validateHeaderSignature;
