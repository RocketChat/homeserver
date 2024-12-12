import { Elysia } from "elysia";
import { isMongodbContext } from "../../plugins/isMongodbContext";
import { generateId } from "../../authentication";
import type { EventBase } from "@hs/core/src/events/eventBase";

export const sendTransactionRoute = new Elysia().put(
	"/send/:txnId",
	async ({ params, body, ...context }) => {
		console.log("receive send ->", params);
		console.log("body ->", body);

		if (!isMongodbContext(context)) {
			throw new Error("No mongodb context");
		}

		const {
			mongo: { eventsCollection },
		} = context;

		const { pdus, edu } = body as any;

		if (edu.length > 100) {
			throw new Error("Too many edus");
		}

		const isValidPDU = (pdu: any): pdu is EventBase => {
			if (typeof pdu !== "object") {
				return false;
			}
			if (typeof pdu.type !== "string") {
				return false;
			}
			if (typeof pdu.room_id !== "string") {
				return false;
			}
			if ("auth_events" in pdu && !Array.isArray(pdu.auth_events)) {
				return false;
			}
			if ("prev_events" in pdu && !Array.isArray(pdu.prev_events)) {
				return false;
			}
			return true;
		};

		const isValidPDUs = (pdus: any): pdus is EventBase[] => {
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
			await eventsCollection.insertMany(
				pdus.map((event) => ({
					_id: generateId(event),
					event,
				})),
			);
		}

		return {
			[params.txnId]: {},
		};
	},
);
