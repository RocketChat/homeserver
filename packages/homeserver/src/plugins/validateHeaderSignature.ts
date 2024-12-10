import { Elysia, t, type Context } from "elysia";
import {
	extractSignaturesFromHeader,
	validateAuthorizationHeader,
} from "../authentication";
import { isValidAlgorithm, verifyJsonSignature } from "../signJson";
import { isConfigContext } from "./isConfigContext";
import { isMongodbContext } from "./isMongodbContext";
import { makeGetPublicKeyFromServerProcedure } from "../procedures/getPublicKeyFromServer";
import { makeRequest } from "../makeRequest";
import { ForbiddenError, UnknownTokenError } from "../errors";

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

export const validateHeaderSignature = () =>
	new Elysia({
		name: "@hs/validateHeaderSignature",
	}).derive(
		{ as: "global" },
		async function deriveOrigin({
			headers: { authorization },
			request,
			body,
			...context
		}) {
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

				const getPublicKeyForServer = makeGetPublicKeyFromServerProcedure(
					context.mongo.getPublicKeyFromLocal,
					async () => {
						const result = await makeRequest({
							method: "GET",
							domain: origin.origin,
							uri: "/_matrix/key/v2/server",
						});

						const [, publickey] =
							Object.entries(result.verify_keys).find(
								([key]) => key === origin.key,
							) ?? [];

						if (!publickey) {
							throw new Error("Public key not found");
						}

						const [algorithm, version] = origin.key.split(":");

						if (!isValidAlgorithm(algorithm)) {
							throw new Error("Invalid algorithm");
						}

						if (
							!(await verifyJsonSignature(
								result,
								origin.origin,
								new TextEncoder().encode(origin.signature),
								new TextEncoder().encode(publickey.key),
								algorithm,
								version,
							))
						) {
							throw new Error("Invalid signature");
						}

						return publickey.key;
					},
					context.mongo.storePublicKey,
				);

				const publickey = await getPublicKeyForServer(
					origin.origin,
					origin.key,
				);

				if (
					!(await validateAuthorizationHeader(
						origin.origin,
						publickey,
						origin.destination,
						request.method,
						"/",
						origin.signature,
						body as any,
					))
				) {
					throw new Error("Invalid signature");
				}
				return {
					get origin() {
						return origin;
					},
				};
			} catch (error) {
				if (error instanceof ForbiddenError) {
					throw error;
				}
				if (error instanceof Error) {
					throw new UnknownTokenError(error.message);
				}
			}
			throw new UnknownTokenError("Unknown error");
		},
	);

export default validateHeaderSignature;
