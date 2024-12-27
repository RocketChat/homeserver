import type { EventBase } from "@hs/core/src/events/eventBase";
import { generateId, type HashedEvent } from "../authentication";
import type { SignedEvent } from "../signJson";
import { checkSignAndHashes } from "../routes/federation/checkSignAndHashes";
import {
	checkEventAuthorization,
	ensureAuthorizationRulesAndStoreBatch,
} from "./autorization/ensureAuthorizationRules";
import { MatrixError } from "../errors";
import type { EventStore } from "../plugins/mongodb";
import { makeRequest } from "../makeRequest";

const loadOrFetchAuthEventsForPDU = async (
	pdu: SignedEvent<HashedEvent<EventBase>>,
	claimedAuthEventsId: string[],
	events: {
		insertMany: (events: EventStore[]) => Promise<void>;
		insertOne: (event: EventStore) => Promise<void>;
		upsertRoom: (roomId: string, state: EventBase[]) => Promise<void>;
		getByIds: (roomId: string, eventIds: string[]) => Promise<EventStore[]>;
	},
) => {
	const claimedAuthEventsFromDb = await events.getByIds(
		pdu.room_id,
		claimedAuthEventsId,
	);

	const claimedAuthEvents = new Map(
		claimedAuthEventsFromDb.map((event) => [event._id, event.event]),
	);

	const missingAuthEvents = claimedAuthEventsId.filter(
		(eventId) => !claimedAuthEvents.get(eventId),
	);

	if (!missingAuthEvents.length) {
		return claimedAuthEvents;
	}

	const eventId = generateId(pdu);

	const { auth_chain } = await makeRequest({
		method: "GET",
		domain: pdu.origin,
		uri: `/_matrix/federation/v1/event_auth/${pdu.room_id}/${eventId}`,
		signingName: "asd",
	});

	for (const event of auth_chain) {
		claimedAuthEvents.set(generateId(event), event);
	}

	const missingAuthEventsFromRemote = missingAuthEvents.filter(
		(eventId) => !claimedAuthEvents.get(eventId),
	);

	if (!missingAuthEventsFromRemote.length) {
		return claimedAuthEvents;
	}

	throw new MatrixError("400", "Missing auth events");
};

export const processSendJoinResponse = async (
	keys: {
		getPublicKeyFromServer: (origin: string, key: string) => Promise<string>;
	},
	events: {
		insertMany: (events: EventStore[]) => Promise<void>;
		insertOne: (event: EventStore) => Promise<void>;
		upsertRoom: (roomId: string, state: EventBase[]) => Promise<void>;
		getByIds: (roomId: string, eventIds: string[]) => Promise<EventStore[]>;
	},
	pdu: SignedEvent<HashedEvent<EventBase>>,
	state: EventBase[],
	authChain: EventBase[],
) => {
	await authAndPersistOutliers(state, authChain, keys, events, pdu);

	const claimedAuthEvents = await loadOrFetchAuthEventsForPDU(
		pdu,
		pdu.auth_events,
		events,
	);

	if (await checkEventAuthorization(pdu, claimedAuthEvents)) {
		await events.insertOne({
			_id: generateId(pdu),
			event: pdu,
		});
	}

	await ensureAuthorizationRulesAndStoreBatch(
		events,
		[...claimedAuthEvents.values()],
		pdu.room_id,
		100,
	);
};

async function authAndPersistOutliers(
	state: EventBase[],
	authChain: EventBase[],
	keys: {
		getPublicKeyFromServer: (origin: string, key: string) => Promise<string>;
	},
	events: {
		insertMany: (events: EventStore[]) => Promise<void>;
		insertOne: (event: EventStore) => Promise<void>;
		upsertRoom: (roomId: string, state: EventBase[]) => Promise<void>;
		getByIds: (roomId: string, eventIds: string[]) => Promise<EventStore[]>;
	},
	pdu: SignedEvent<HashedEvent<EventBase>>,
) {
	const createEvent = state.find((event) => event.type === "m.room.create");

	if (!createEvent) {
		throw new MatrixError("400", "Invalid response");
	}

	const auth_chain = new Map(
		authChain.map((event) => [generateId(event), event]),
	);

	const states = new Map(state.map((event) => [generateId(event), event]));

	const validPDUs = new Map<string, EventBase>();

	for await (const [eventId, event] of [
		...auth_chain.entries(),
		...states.entries(),
	]) {
		// check sign and hash of event
		if (
			await checkSignAndHashes(
				event,
				event.origin,
				keys.getPublicKeyFromServer,
			).catch((e) => {
				console.log("Error checking signature", e);
				return false;
			})
		) {
			validPDUs.set(eventId, event);
		} else {
			console.log("Invalid event", event);
		}
	}

	const signedAuthChain = [...auth_chain.entries()].filter(([eventId]) =>
		validPDUs.has(eventId),
	);

	const signedState = [...states.entries()].filter(([eventId]) =>
		validPDUs.has(eventId),
	);

	const signedCreateEvent = signedAuthChain.find(
		([, event]) => event.type === "m.room.create",
	);

	if (!signedCreateEvent) {
		throw new MatrixError("400", "Unexpected create event(s) in auth chain");
	}

	// TODO: this should be placed in a different moment
	await events.upsertRoom(
		signedCreateEvent[1].room_id,
		signedState.map(([, event]) => event),
	);

	await ensureAuthorizationRulesAndStoreBatch(
		events,
		signedAuthChain.map(([, event]) => event),
		pdu.room_id,
	);
}
