import assert from "node:assert";
import crypto from "node:crypto";
import {
	getStateMapKey,
	iterativeAuthChecks,
	partitionState,
	type EventStore,
} from "../definitions";
import { type EventID, type StateMapKey } from "../../../types/_common";
import { PersistentEventBase } from "../../../manager/event-manager";
import {
	PduTypeRoomCreate,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomPowerLevels,
} from "../../../types/v1";

export async function resolveStateV1(
	events: PersistentEventBase[],
	store: EventStore,
) {
	const eventIdMap = new Map<EventID, PersistentEventBase>();
	const eventHashToEventIdMap = new Map<string, EventID>();

	for (const event of events) {
		eventIdMap.set(event.eventId, event);
		eventHashToEventIdMap.set(event.sha256hash, event.eventId);
	}

	// use this wrapped store to use cached events that can be fetched from memory
	// I am thinking we may not need it later
	const wrappedStore: typeof store = {
		async getEvents(eventIds) {
			const resultEvents = [] as PersistentEventBase[];

			const eventIdsToFind = [] as string[];

			for (const eventId of eventIds) {
				const event = eventIdMap.get(eventId);
				if (event) {
					resultEvents.push(event);
				} else {
					eventIdsToFind.push(eventId);
				}
			}

			const events = await store.getEvents(eventIdsToFind);

			for (const event of events) {
				resultEvents.push(event);
				eventIdMap.set(event.eventId, event);
				eventHashToEventIdMap.set(event.sha256hash, event.eventId);
			}

			return resultEvents;
		},

		async getEventsByHashes(hashes) {
			const resultEvents = [] as PersistentEventBase[];

			const hashesToFind = [] as string[];

			for (const hash of hashes) {
				const eventId = eventHashToEventIdMap.get(hash);
				if (eventId) {
					resultEvents.push(eventIdMap.get(eventId)!);
				} else {
					hashesToFind.push(hash);
				}
			}

			const events = await store.getEventsByHashes(hashesToFind);

			for (const event of events) {
				resultEvents.push(event);
				eventIdMap.set(event.eventId, event);
				eventHashToEventIdMap.set(event.sha256hash, event.eventId);
			}

			return resultEvents;
		},
	};

	const [unconflicted, conflicted] = partitionState(eventIdMap.values());

	const roomCreateEventId = unconflicted.get(
		getStateMapKey({ type: PduTypeRoomCreate }),
	);

	const roomCreateEvent = eventIdMap.get(roomCreateEventId as string);

	assert(roomCreateEvent, "roomCreateEvent should not be null");

	let R = new Map<StateMapKey, PersistentEventBase>();
	for (const [key, value] of unconflicted.entries()) {
		R.set(key, eventIdMap.get(value as string)!);
	}

	const powerLevelKey = getStateMapKey({ type: PduTypeRoomPowerLevels });
	const joinRulesKey = getStateMapKey({ type: PduTypeRoomJoinRules });

	const compareFunc = (a: EventID, b: EventID) => {
		const aDepth = eventIdMap.get(a)?.depth ?? 0;
		const bDepth = eventIdMap.get(b)?.depth ?? 0;
		if (aDepth !== bDepth) {
			return aDepth - bDepth;
		}

		const ahash = crypto.createHash("sha1").update(a).digest("hex");
		const bhash = crypto.createHash("sha1").update(b).digest("hex");
		return bhash.localeCompare(ahash);
	};

	// First we resolve conflicts between m.room.power_levels events. If there is no conflict, this step is skipped, otherwise:
	// Assemble all the m.room.power_levels events from the states to be resolved into a list.
	const conflictedPowerlevels = conflicted.get(powerLevelKey);

	if (conflictedPowerlevels) {
		// Sort the list by ascending depth then descending sha1(event_id).
		const sortedPowerlevels = [...conflictedPowerlevels].sort(compareFunc);

		const currentPowerLevelEventId = sortedPowerlevels.shift()!;

		const currentPowerLevelEvent = eventIdMap.get(currentPowerLevelEventId)!;

		// Add the first event in the list to R.
		R.set(powerLevelKey, currentPowerLevelEvent);

		R = await iterativeAuthChecks(
			sortedPowerlevels.map((eid) => eventIdMap.get(eid)!),
			R,
			wrappedStore,
		);

		conflicted.delete(powerLevelKey);
	}

	// Repeat the above process for conflicts between m.room.join_rules events.
	const conflictedJoinRules = conflicted.get(joinRulesKey);

	if (conflictedJoinRules) {
		const sortedJoinRules = [...conflictedJoinRules].sort(compareFunc);

		const currentJoinRuleEventId = sortedJoinRules.shift()!;
		const currentJoinRuleEvent = eventIdMap.get(currentJoinRuleEventId)!;

		R.set(joinRulesKey, currentJoinRuleEvent);

		R = await iterativeAuthChecks(
			sortedJoinRules.map((eid) => eventIdMap.get(eid)!),
			R,
			wrappedStore,
		);

		conflicted.delete(joinRulesKey);
	}

	for (const conflictedMemberKey of conflicted.keys()) {
		if (!conflictedMemberKey.startsWith(PduTypeRoomMember)) {
			continue;
		}

		const conflictedMemberEventIds = conflicted.get(conflictedMemberKey);

		if (!conflictedMemberEventIds) {
			continue;
		}

		const sortedMemberEventIds = [...conflictedMemberEventIds].sort(
			compareFunc,
		);

		const currentMemberEventId = sortedMemberEventIds.shift()!;
		const currentMemberEvent = eventIdMap.get(currentMemberEventId)!;

		R.set(conflictedMemberKey, currentMemberEvent);

		R = await iterativeAuthChecks(
			sortedMemberEventIds.map((eid) => eventIdMap.get(eid)!),
			R,
			wrappedStore,
		);

		conflicted.delete(conflictedMemberKey);
	}

	if (conflicted.size === 0) {
		return R;
	}

	for (const conflictedEventKey of conflicted.keys()) {
		const conflictedEventIds = conflicted.get(conflictedEventKey);

		if (!conflictedEventIds) {
			continue;
		}

		const sortedEventIds = [...conflictedEventIds].sort(compareFunc);

		for (const eventId of sortedEventIds) {
			const event = eventIdMap.get(eventId)!;
			try {
				await iterativeAuthChecks([event], R, wrappedStore);
				R.set(conflictedEventKey, event);
				break;
			} catch (e) {
				console.warn("event failed", e);
			}
		}

		conflicted.delete(conflictedEventKey);
	}

	return R;
}
