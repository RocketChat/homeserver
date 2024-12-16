import { Elysia } from "elysia";
import { isMongodbContext } from "../../plugins/isMongodbContext";
import { type HashedEvent, generateId } from "../../authentication";
import type { EventBase } from "@hs/core/src/events/eventBase";
import {
	encodeCanonicalJson,
	getSignaturesFromRemote,
	verifyJsonSignature,
	verifySignature,
	type SignedJson,
} from "../../signJson";
import { pruneEventDict } from "../../pruneEventDict";
import {
	getPublicKeyFromRemoteServer,
	makeGetPublicKeyFromServerProcedure,
} from "../../procedures/getPublicKeyFromServer";
import { isConfigContext } from "../../plugins/isConfigContext";
import { MatrixError } from "../../errors";

export const sendTransactionRoute = new Elysia().put(
	"/send/:txnId",
	async ({ params, body, ...context }) => {
		if (!isConfigContext(context)) {
			throw new Error("No config context");
		}
		if (!isMongodbContext(context)) {
			throw new Error("No mongodb context");
		}

		const {
			config,
			mongo: { eventsCollection },
		} = context;

		const { pdus, edus = [] } = body as any;

		if (edus.length > 100) {
			throw new MatrixError("400", "Too many edus");
		}

		console.log("1");
		const isValidPDU = (
			pdu: any,
		): pdu is SignedJson<HashedEvent<EventBase>> => {
			// if (!("event_id" in pdu)) {
			// 	return false;
			// }
			if (typeof pdu !== "object") {
				return false;
			}
			if (typeof pdu.type !== "string") {
				return false;
			}
			if (typeof pdu.room_id !== "string") {
				return false;
			}
			// if (!("auth_events" in pdu) || !Array.isArray(pdu.auth_events)) {
			// 	return false;
			// }
			// if (!("prev_events" in pdu) || !Array.isArray(pdu.prev_events)) {
			// 	return false;
			// }
			// if (!("signatures" in pdu) && typeof pdu.signatures !== "object") {
			// 	return false;
			// }

			return true;
		};

		const isValidPDUs = (
			pdus: any,
		): pdus is SignedJson<HashedEvent<EventBase>>[] => {
			if (!Array.isArray(pdus)) {
				return false;
			}

			if (pdus.length > 50) {
				throw new Error("Too many pdus");
			}

			return pdus.every(isValidPDU);
		};

		// TODO: validate PDUs
		if (isValidPDUs(pdus)) {
			const pdusByRoomId = new Map<
				string,
				SignedJson<HashedEvent<EventBase>>[]
			>();

			for (const pdu of pdus) {
				const roomId = pdu.room_id;
				if (!roomId) {
					continue;
				}
				const pduByRoomId = pdusByRoomId.get(roomId) ?? [];
				pduByRoomId.push(pdu);
				pdusByRoomId.set(roomId, pduByRoomId);
			}

			const validatePdu = async (pdu: SignedJson<HashedEvent<EventBase>>) => {
				const origin = pdu.sender.split(":").pop() as string;

				if (!origin) {
					throw new MatrixError("400", "Invalid origin");
				}
				const [signature] = await getSignaturesFromRemote(pdu, origin);
				const { signatures, unsigned, ...rest } = pdu;

				const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
					context.mongo.getValidPublicKeyFromLocal,
					() =>
						getPublicKeyFromRemoteServer(
							origin,
							config.name,
							`${signature.algorithm}:${signature.version}`,
						),

					context.mongo.storePublicKey,
				);

				const publicKey = await getPublicKeyFromServer(
					origin,
					`${signature.algorithm}:${signature.version}`,
				);

				if (
					!verifyJsonSignature(
						pruneEventDict(rest),
						origin,
						Uint8Array.from(atob(signature.signature), (c) => c.charCodeAt(0)),
						Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0)),
						signature.algorithm,
						signature.version,
					)
				) {
					throw new MatrixError("400", "Invalid signature");
				}
			};

			const resultPDUs = {} as {
				[key: string]: Record<string, unknown>;
			};

			for (const [roomId, pdus] of pdusByRoomId) {
				// const roomVersion = getRoomVersion
				for (const pdu of pdus) {
					if (
						!(await validatePdu(pdu).catch((e) => {
							console.error("error validating pdu", e);
							return true;
						}))
					) {
						resultPDUs[`${generateId(pdu)}`] = {};
					}
				}
			}

			await eventsCollection
				.insertMany(
					pdus.map((event) => ({
						_id: generateId(event),
						event,
					})),
				)
				.catch((e) => {
					console.error("error saving event", e);
				});

			return {
				pdus: resultPDUs,
			};
		}
	},
);
