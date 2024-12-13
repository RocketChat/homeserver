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
import { isRoomMemberEvent } from "@hs/core/src/events/m.room.member";

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
			mongo: { eventsCollection, createStagingEvent },
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
				const extractOrigin = (sender: string) =>
					sender.split(":").pop() as string;

				const isInviteVia3pid = (event: EventBase) =>
					isRoomMemberEvent(event) &&
					event.content.membership === "invite" &&
					"third_party_invite" in event.content;

				const origins = [
					!isInviteVia3pid(pdu) && extractOrigin(pdu.sender),
					// extractOrigin(pdu.sender) !== extractOrigin(pdu.event_id) &&
					// 	extractOrigin(pdu.event_id),
					isRoomMemberEvent(pdu) &&
						pdu.content.join_authorised_via_users_server &&
						extractOrigin(pdu.content.join_authorised_via_users_server),
				].filter(Boolean) as string[];

				if (!origins.length) {
					throw new MatrixError("400", "Invalid Signature");
				}

				for await (const origin of origins) {
					const { signatures, unsigned, ...rest } = pdu;

					const [signature] = await getSignaturesFromRemote(pdu, origin);

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
							Uint8Array.from(atob(signature.signature), (c) =>
								c.charCodeAt(0),
							),
							Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0)),
							signature.algorithm,
							signature.version,
						)
					) {
						throw new MatrixError("400", "Invalid signature");
					}
				}
			};

			const resultPDUs = {} as {
				[key: string]: Record<string, unknown>;
			};

			for (const [roomId, pdus] of pdusByRoomId) {
				// const roomVersion = getRoomVersion
				for (const pdu of pdus) {
					try {
						await validatePdu(pdu);
						resultPDUs[`${generateId(pdu)}`] = {};
						void createStagingEvent(pdu);
					} catch (e) {
						console.error("error validating pdu", e);
						resultPDUs[`${generateId(pdu)}`] = e as any;
					}
				}
			}

			return {
				pdus: resultPDUs,
			};
		}
	},
);
