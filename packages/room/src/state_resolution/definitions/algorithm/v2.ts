/*
 * let's explain the algorithm in simple terms.
 * 1. Two concepts, unconflicted state and conflicted state.
 * 	Unconflicted state is where we can align the state events linearly and trust it resolves correctly. Each state event changes the state of the room exactly once.
 * 	Conflicted state is where we have multiple events trying to change the same state "type" (like room topic  for example) and we have to resolve which one is the correct one.
 * 	Another concept is a "full conflicted set" - which by definition is the merged set of all the events in the conflicted state, and something called "auth difference".
 * 	Auth Chain - first of all, is all the auth events that allows an event to be valid, or exist in an ideal world, and all the auth events of the auth events, and so on recursively.
 * 	Now, auth difference - for all events in the list of state events, each event has its own auth chain which is a list of auth events. If we take all the events in all the auth chains, and all the events that were in all the auth chains, and perform a difference on those two sets we get the auth difference.
 * 	Auth difference is the auth events that are not in ALL THE AUTH CHAINS.
 * 	Any state event has a graph of auth events behind it. For instance m.room.create will always be the root of the graph of all state events because this is where a room begins. There is no state without a room create event.
 * 	Thus for every state event, the graph starts the same way, m.room.create -> <some state event> -> <so on>.
 * 	Once we take out the auth events that are common to all the auth chains (or graphs created by the auth chains), what we get are the events that that started tio deviate the graph's flow.
 * 	This list of events are NOT necesarily "conflicted" - it's deviated. The graph is not a linear linked list of events, the deviation is the branches, and not all branches must be common.
 * 	But this list CAN have conflicted events, which will later be resolved.
 * 	It helps identify events that only appear in some state resolutions, which could represent divergent histories or forks in the graph. They may not directly be in the conflicted state, but can affect validity.
 * --------------------------------
 * 2. Power events - are those that directly affect authorization logic—such as setting power levels, join rules, or certain membership changes (like bans or kicks).
 * --------------------------------
 * ||||| Algorithm |||||
 * --------------------------------
 * 1. Take the full conflicted set of state events, i.e. all the events in the conflicted state + the auth difference (potential conflicts);
 * 2. Take X | X is the set of all power events that appear in the full conflicted set; // events that dictate the power of certain users let's say
 * 3. For each event in X that is P (power event):
 * 	- Get the auth chain of P
 * 	- For each event in the auth chain of P:
 * 		- If the event is in the full conflicted set and is not in X, add it to X
 * 		// ^^^ To get the final list of power events that can actually validate the state events of the room
 * 		// we get the auth event of the power event that is "conflicted" and add to our existing power event set
 * 		// this builds a set of events, that are both power events and auth events that dictate whether the power events are valid or not
 * 		// This step ensures that any events required to verify the validity of power events (i.e., their auth chain members that are also in the full conflicted set) are included and processed first, so we can later correctly apply auth checks.
 * 4. Sort the set X using the reverse topological power ordering;
 * // ^^^ X IS a graph itself, since each power event possibly has a relation with another event in the set, its auth event, this builds the relation and the edges
 * // kahn's algorithm is used, since what we have is a directed graph, kahn's algorithm here essentially sorts the events by their preference, the higher the preference the lower the index in the final list
 * // you cannot validate someone’s power level change unless you first validate the event that gave them that power.
 * 	- The comparison function used is (for events x and y):
 * 	if x's sender has greater power level than y's sender (essentially x is preferred over y)
 * 	if x's origin_server_ts is less than y's origin_server_ts (x happens before y)
 * 	if x's event_id is less than y's event_id (meh, cause we have to pick ONE)
 * // what we have now is a sorted by preference list of power events (and their deciding auth events)
 * 5. We start with the unconflicted state list, and we check for each event in the list there if is allowed by the event type's auth rules (think of propreitary rules for each event type, doesn't matter to this algorithm)
 * 6. Now also run the same auth rule validation on the power events list, since the list is in order or preference, the more preferred conflicted event will make it to the state first, then the auth rule will decide if the next coinflicting event will replace the previous one or not.
 * 7. Merge both resolved state event lists to get the partially resolved state;
 * 8. Take the rest of the events from the full conflicted set that are not in the power events list and order them by the mainline ordering based on the power level event in the partially resolved state (different from a power event, power level event is an exact event type and can only be one in the room that dictates the power level of the users in the room);
 * // ^^^ mainline ordering essentially does a similar thing to kahn's. It sorts the events in it's order of preference,
 * // mainline of a power level event is all the power level event that came before it.
 * // "mainline position" of an event is how far back in the historical power level of the room was th event created.
 * // we sort the events by their mainline position first, indicating how far back in the history of the room the event was created, then we sort by origin_server_ts and event_id (event_id because we have to pick one, yknow)
 * // so we get a sorted list of events where the lower the index, the earlier the event was created (based on earlier power level) even if it was sent later.
 * 9. Run the auth rule validation on the sorted events list, and the last partially resolved state list;
 * 10. Finally merge with the initial unconflicted state list to get the final resolved state;
 * // ^^^ this is the final state of the room, all events are in order of preference and are allowed by the auth rules
 */

// parts of above explanation is in each segment of written code.
// you may think I am a responsible developer, that I am writing comments to explain the code.
// I am not.
// these comments are more for me, these are keeping me sane.
// i am too early in this to remember everything by heart.

import assert from 'node:assert';
import { PduTypeRoomPowerLevels } from '../../../types/v1';
import {
	type EventStore,
	getStateMapKey,
	partitionState,
	getAuthChain,
	reverseTopologicalPowerSort,
	iterativeAuthChecks,
	mainlineOrdering,
	getAuthChainDifference,
	isPowerEvent,
} from '../definitions';
import type { EventID, StateMapKey } from '../../../types/_common';
import { PersistentEventBase } from '../../../manager/event-manager';
import { isTruthy } from './v1';

// https://spec.matrix.org/v1.12/rooms/v2/#algorithm
export async function resolveStateV2Plus(
	states: ReadonlyMap<StateMapKey, PersistentEventBase>[],
	store: EventStore, // with cache
): Promise<Map<StateMapKey, PersistentEventBase>> {
	// memory o'memory
	// const eventMap = new Map<string, PduV3>();

	const eventIdToEventMap = new Map<EventID, PersistentEventBase>(); // cache used everywhere

	const eventHashToEventIdMap = new Map<string, EventID>();

	for (const state of states) {
		for (const event of state.values()) {
			eventIdToEventMap.set(event.eventId, event);
			eventHashToEventIdMap.set(event.sha256hash, event.eventId);
		}
	}

	// use this wrapped store to use cached events that can be fetched from memory
	// I am thinking we may not need it later
	const wrappedStore: typeof store = {
		async getEvents(eventIds) {
			const resultEvents = [] as PersistentEventBase[];

			const eventIdsToFind = [] as string[];

			for (const eventId of eventIds) {
				const event = eventIdToEventMap.get(eventId);
				if (event) {
					resultEvents.push(event);
				} else {
					eventIdsToFind.push(eventId);
				}
			}

			const events = await store.getEvents(eventIdsToFind);

			for (const event of events) {
				resultEvents.push(event);
				eventIdToEventMap.set(event.eventId, event);
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
					const value = eventIdToEventMap.get(eventId);
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
				eventIdToEventMap.set(event.eventId, event);
				eventHashToEventIdMap.set(event.sha256hash, event.eventId);
			}

			return resultEvents;
		},
	};

	// 1. Select the set X of all power events that appear in the full conflicted set.

	const [unconflicted, conflicted] = partitionState(eventIdToEventMap.values());

	const unconflictedStateMap = unconflicted
		.entries()
		.reduce((accum, [stateKey, eventId]) => {
			const event = eventIdToEventMap.get(eventId);
			assert(event, 'event should not be null');
			accum.set(stateKey, event);
			return accum;
		}, new Map<StateMapKey, PersistentEventBase>());

	if (conflicted.size === 0) {
		// no conflicted state, return the unconflicted state
		return unconflictedStateMap;
	}

	// ajuthchain diff calculation will require non unique statekeys
	const authChainDifference = await getAuthChainDifference(
		states.map(
			(state) =>
				new Map<StateMapKey, EventID>(
					state.entries().map(([stateKey, event]) => [stateKey, event.eventId]),
				),
		),
		wrappedStore,
	);

	const fullConflictedSet = conflicted.values().reduce((accum, curr) => {
		// biome-ignore lint/complexity/noForEach: <explanation>
		curr.forEach((c) => accum.add(c));

		return accum;
	}, authChainDifference);

	// events that dictate authorization logic
	// should a user be able to change the power level of another user?
	// should a user be able to change the topic of the room?
	// should a user be able to change the name of the room?
	// should a user be able to change the room visibility?
	// should a user be able to change the room join rules?
	// etc.
	const powerEvents = new Map<EventID, PersistentEventBase>(); // using map instead of set to store the event objects uniquely

	for (const eventid of fullConflictedSet) {
		const [event] = await wrappedStore.getEvents([eventid]);
		if (!event) {
			console.warn('event not found in eventMap', eventid);
			continue;
		}
		if (isPowerEvent(event)) {
			powerEvents.set(event.eventId, event);
		}
	}

	//  For each such power event P, enlarge X by adding the events in the auth chain of P which also belong to the full conflicted set.

	for (const event of powerEvents.values()) {
		// pass cache
		const authChain = await getAuthChain(event, wrappedStore);

		for (const authEventId of authChain) {
			const [authEvent] = await wrappedStore.getEvents([authEventId]);

			if (!authEvent) {
				// at this point the event MUST exist
				throw new Error(`auth event not found in eventMap: ${authEventId}`);
			}

			if (
				/* authEvent is conflicted */
				fullConflictedSet.has(authEvent.eventId) &&
				/* is power event */
				isPowerEvent(authEvent) &&
				/* it isn't in the list already */
				// TODO: use a map here
				!powerEvents.has(authEvent.eventId)
			) {
				powerEvents.set(authEvent.eventId, authEvent);
			}
		}
	}

	// should now have all power events and all events that allows those power events to exist
	// now we have to sort them by preference (power level, time created at)

	// Sort X into a list using the reverse topological power ordering.
	const sortedPowerEvents = await reverseTopologicalPowerSort(
		powerEvents.values(),
		fullConflictedSet, // context, we don't want to overload the action, sort needs to mostly care about the power events in the full conflicted set
		unconflictedStateMap, // current state just for  create event mostly
		wrappedStore,
	);

	// 2. Apply the iterative auth checks algorithm, starting from the unconflicted state map, to the list of events from the previous step to get a partially resolved state.
	const initialState = new Map<StateMapKey, PersistentEventBase>();
	for (const [key, eventId] of unconflicted) {
		// self explanatory
		const [event] = await wrappedStore.getEvents([eventId]);
		assert(event, `event should not be null ${eventId}`);
		initialState.set(key, event);
	}

	// we have all the power events by their preference
	// with the initialState i.e. the unconflicted state, as reference
	// we'll run authorization logic check on the power events.
	// the more priority an event has, the earlier it will be resolved.
	// so subsequent event validation will be biased by the earlier events.
	// why kahns' algorithm matters :)
	const partiallyResolvedState = await iterativeAuthChecks(
		(
			await Promise.all(
				sortedPowerEvents.map(
					(e) => wrappedStore.getEvents([e]), // FIXME:
				),
			)
		).flat(),
		initialState,
		wrappedStore,
	);

	// 3. Take all remaining events that weren’t picked in step 1 and order them by the mainline ordering based on the power level in the partially resolved state obtained in step 2.
	const remainingEvents = fullConflictedSet
		.values()
		.filter((e) => !sortedPowerEvents.includes(e))
		.toArray();

	// ^^ non power events, since we should have power events figured out already, i.e. having single resolved power level event, single resolved join rules event, etc.
	// we can validate if the rest of the events are "allowed" or not

	const powerLevelEvent = partiallyResolvedState.get(
		getStateMapKey({ type: PduTypeRoomPowerLevels }),
	);

	assert(powerLevelEvent, 'power level event should not be null');

	// mainline ordering essentially sorts the rest of the events
	// by their place in the history of the room's power levels.
	// each event will have an associated power level event (auth event), which allows the event to be valid.
	// if we have two power level events A -> B, A earlier, B overriding A.
	// two state events X, Y - Y sent earlier than X, however, X is allowed by A and Y by B. [{ Y, (B) }, { X, (A) }]
	// since the power level event that allowed X (A) is earlier, the mainline ordering will put X before Y.
	// mainlineSort([Y, X]) -> [X, Y] because A < B

	const sanitizedRemainingEvents = remainingEvents.map((e) => eventIdToEventMap.get(e)).filter(isTruthy);

	const orderedRemainingEvents = await mainlineOrdering(
		sanitizedRemainingEvents,
		powerLevelEvent,
		initialState,
		wrappedStore,
	);

	// 4. Apply the iterative auth checks algorithm on the partial resolved state and the list of events from the previous step.
	const finalState = await iterativeAuthChecks(
		orderedRemainingEvents,
		partiallyResolvedState,
		wrappedStore,
	);

	// 5. Update the result by replacing any event with the event with the same key from the unconflicted state map, if such an event exists, to get the final resolved state.
	for (const [key, value] of unconflicted) {
		if (finalState.has(key)) {
			const [event] = await wrappedStore.getEvents([value]);
			assert(event, 'event should not be null');
			finalState.set(key, event);
		}
	}

	return finalState;
}
