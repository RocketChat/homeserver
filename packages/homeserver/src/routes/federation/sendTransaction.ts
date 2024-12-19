import { Elysia } from "elysia";
import { isMongodbContext } from "../../plugins/isMongodbContext";
import { type HashedEvent, generateId } from "../../authentication";
import type { EventBase } from "@hs/core/src/events/eventBase";
import {
	encodeCanonicalJson,
	verifySignature,
	type SignedJson,
} from "../../signJson";
import {
	getPublicKeyFromRemoteServer,
	makeGetPublicKeyFromServerProcedure,
} from "../../procedures/getPublicKeyFromServer";
import { isConfigContext } from "../../plugins/isConfigContext";
import { MatrixError } from "../../errors";
import { isRoomMemberEvent } from "@hs/core/src/events/m.room.member";
import { makeRequest } from "../../makeRequest";
import { isMutexContext, routerWithMutex } from "../../plugins/mutex";
import { processPDUsByRoomId } from "../../procedures/processPDU";
import type { Config } from "../../plugins/config";
import { checkSignAndHashes } from "./checkSignAndHashes";

const extractOrigin = (sender: string) => sender.split(":").pop() as string;

const isInviteVia3pid = (event: EventBase) =>
	isRoomMemberEvent(event) &&
	event.content.membership === "invite" &&
	"third_party_invite" in event.content;

export const sendTransactionRoute = new Elysia()
	.use(routerWithMutex)
	.put("/send/:txnId", async ({ params, body, ...context }) => {
		if (!isConfigContext(context)) {
			throw new Error("No config context");
		}
		if (!isMongodbContext(context)) {
			throw new Error("No mongodb context");
		}
		if (!isMutexContext(context)) {
			throw new Error("No mutex context");
		}

		const {
			config,
			mongo: {
				getEventsByIds,
				createStagingEvent,
				createEvent,
				removeEventFromStaged,
				getOldestStagedEvent,
			},
		} = context;

		const { pdus, edus = [] } = body as any;

		if (edus.length > 100) {
			throw new MatrixError("400", "Too many edus");
		}

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
					const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
						context.mongo.getValidPublicKeyFromLocal,
						(origin, key) =>
							getPublicKeyFromRemoteServer(origin, config.name, key),

						context.mongo.storePublicKey,
					);
					await checkSignAndHashes(pdu, origin, getPublicKeyFromServer);
				}
			};

			/**
			 * Based on the fetched events from the remote server, we check if there are any new events (that haven't been stored yet)
			 * @param fetchedEvents
			 * @returns
			 */

			const getNewEvents = async (
				roomId: string,
				fetchedEvents: EventBase[],
			) => {
				const fetchedEventsIds = fetchedEvents.map(generateId);
				const storedEvents = await getEventsByIds(roomId, fetchedEventsIds);
				return fetchedEvents
					.filter(
						(event) => !storedEvents.find((e) => e._id === generateId(event)),
					)
					.sort((a, b) => a.depth - b.depth);
			};

			const processMissingEvents = async (roomId: string) => {
				using lock = await context.mutex.request(roomId, true);
				const event = await getOldestStagedEvent(roomId);

				if (!event) {
					return false;
				}

				const { _id: pid, event: pdu } = event;
				const fetchedEvents = await makeRequest({
					method: "POST",
					domain: pdu.origin,
					uri: `/_matrix/federation/v1/get_missing_events/${pdu.room_id}`,
					body: {
						earliest_events: pdu.prev_events,
						latest_events: [pid],
						limit: 10,
						min_depth: 10,
					},
					signingName: config.name,
				});

				const newEvents = await getNewEvents(roomId, fetchedEvents.events);
				// in theory, we have all the new events
				await removeEventFromStaged(roomId, pid);

				for await (const event of newEvents) {
					await createStagingEvent(event);
				}

				return true;
			};
			const result = {
				pdus: {},
			};
			for await (const [roomId, pdus] of pdusByRoomId) {
				Object.assign(
					result.pdus,
					await processPDUsByRoomId(
						roomId,
						pdus,
						validatePdu,
						getEventsByIds,
						createStagingEvent,
						createEvent,
						processMissingEvents,
						generateId,
					),
				);
			}
			return result;
		}
	});
