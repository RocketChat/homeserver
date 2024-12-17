import type { EventBase } from "@hs/core/src/events/eventBase";
import type { SignedJson } from "../signJson";
import type { HashedEvent } from "../authentication";
import type { EventStore } from "../plugins/mongodb";

export const processPDUsByRoomId = async (
	roomId: string,
	pdus: SignedJson<HashedEvent<EventBase>>[],
	validatePdu: (pdu: SignedJson<HashedEvent<EventBase>>) => Promise<void>,
	getEventsByIds: (roomId: string, eventIds: string[]) => Promise<EventStore[]>,
	createStagingEvent: (event: EventBase) => Promise<string>,
	createEvent: (event: EventBase) => Promise<string>,
	processMissingEvents: (roomId: string) => Promise<boolean>,
	generateId: (pdu: SignedJson<HashedEvent<EventBase>>) => string,
) => {
	const resultPDUs = {} as {
		[key: string]: Record<string, unknown>;
	};
	for (const pdu of pdus) {
		const pid = generateId(pdu);
		try {
			await validatePdu(pdu);
			resultPDUs[pid] = {};

			const events = await getEventsByIds(roomId, pdu.prev_events);

			const missing = pdu.prev_events.filter(
				(event) => !events.find((e) => e._id === event),
			);

			if (!missing.length) {
				await createStagingEvent(pdu);
			} else {
				await createEvent(pdu);
			}
		} catch (error) {
			resultPDUs[pid] = { error } as any;
		}
		void (async () => {
			while (await processMissingEvents(roomId));
		})();
	}

	return {
		pdus: resultPDUs,
	};
};
