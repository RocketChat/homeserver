import assert from 'node:assert';
import crypto from 'node:crypto';
import { PersistentEventBase } from '../../../manager/event-wrapper';
import { type EventID, type StateMapKey } from '../../../types/_common';
import {
	PduTypeRoomCreate,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomPowerLevels,
} from '../../../types/v1';
import {
	type EventStore,
	getStateMapKey,
	iterativeAuthChecks,
	partitionState,
} from '../definitions';

export const isTruthy = <T>(
	value: T | null | undefined | false | 0 | '',
): value is T => {
	return Boolean(value);
};

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
					const value = eventIdMap.get(eventId);
					if (value) {
						resultEvents.push(value);
					}
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

	assert(roomCreateEventId, 'roomCreateEventId should not be null');

	const roomCreateEvent = eventIdMap.get(roomCreateEventId);

	assert(roomCreateEvent, 'roomCreateEvent should not be null');

	let R = new Map<StateMapKey, PersistentEventBase>();
	for (const [key, value] of unconflicted.entries()) {
		if (value) {
			const RValue = eventIdMap.get(value);
			if (RValue) {
				R.set(key, RValue);
			}
		}
	}

	const powerLevelKey = getStateMapKey({ type: PduTypeRoomPowerLevels });
	const joinRulesKey = getStateMapKey({ type: PduTypeRoomJoinRules });

	const compareFunc = (a: EventID, b: EventID) => {
		const aDepth = eventIdMap.get(a)?.depth ?? 0;
		const bDepth = eventIdMap.get(b)?.depth ?? 0;
		if (aDepth !== bDepth) {
			return aDepth - bDepth;
		}

		const ahash = crypto.createHash('sha1').update(a).digest('hex');
		const bhash = crypto.createHash('sha1').update(b).digest('hex');
		return bhash.localeCompare(ahash);
	};

	// First we resolve conflicts between m.room.power_levels events. If there is no conflict, this step is skipped, otherwise:
	// Assemble all the m.room.power_levels events from the states to be resolved into a list.
	const conflictedPowerlevels = conflicted.get(powerLevelKey);

	if (conflictedPowerlevels) {
		// Sort the list by ascending depth then descending sha1(event_id).
		const sortedPowerlevels = [...conflictedPowerlevels].sort(compareFunc);

		const currentPowerLevelEventId = sortedPowerlevels.shift();
		assert(
			currentPowerLevelEventId,
			'currentPowerLevelEventId should not be null',
		);

		const currentPowerLevelEvent = eventIdMap.get(currentPowerLevelEventId);
		assert(currentPowerLevelEvent, 'currentPowerLevelEvent should not be null');

		// Add the first event in the list to R.
		R.set(powerLevelKey, currentPowerLevelEvent);

		const powerLevelsEvents = sortedPowerlevels
			.map((eid) => eventIdMap.get(eid))
			.filter(isTruthy);

		R = await iterativeAuthChecks(powerLevelsEvents, R, wrappedStore);

		conflicted.delete(powerLevelKey);
	}

	// Repeat the above process for conflicts between m.room.join_rules events.
	const conflictedJoinRules = conflicted.get(joinRulesKey);

	if (conflictedJoinRules) {
		const sortedJoinRules = [...conflictedJoinRules].sort(compareFunc);

		const currentJoinRuleEventId = sortedJoinRules.shift();
		assert(currentJoinRuleEventId, 'currentJoinRuleEventId should not be null');

		const currentJoinRuleEvent = eventIdMap.get(currentJoinRuleEventId);
		assert(currentJoinRuleEvent, 'currentJoinRuleEvent should not be null');

		R.set(joinRulesKey, currentJoinRuleEvent);

		const joinRulesEvents = sortedJoinRules
			.map((eid) => eventIdMap.get(eid))
			.filter(isTruthy);

		R = await iterativeAuthChecks(joinRulesEvents, R, wrappedStore);

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

		const currentMemberEventId = sortedMemberEventIds.shift();
		assert(currentMemberEventId, 'currentMemberEventId should not be null');

		const currentMemberEvent = eventIdMap.get(currentMemberEventId);
		assert(currentMemberEvent, 'currentMemberEvent should not be null');

		R.set(conflictedMemberKey, currentMemberEvent);

		const memberEventIds = sortedMemberEventIds
			.map((eid) => eventIdMap.get(eid))
			.filter(isTruthy);

		R = await iterativeAuthChecks(memberEventIds, R, wrappedStore);

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
			const event = eventIdMap.get(eventId);
			if (event) {
				try {
					await iterativeAuthChecks([event], R, wrappedStore);
					R.set(conflictedEventKey, event);
					break;
				} catch (e) {
					console.warn('event failed', e);
				}
			}
		}

		conflicted.delete(conflictedEventKey);
	}

	return R;
}
