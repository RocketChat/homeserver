import assert from 'node:assert';

import { PriorityQueue } from '@datastructures-js/priority-queue';

import { StateResolverAuthorizationError } from '../../authorizartion-rules/errors';
import { checkEventAuthWithState } from '../../authorizartion-rules/rules';
import type { PersistentEventBase, State } from '../../manager/event-wrapper';
import { PowerLevelEvent } from '../../manager/power-level-event-wrapper';
import type { RoomVersion } from '../../manager/type';
import type { EventID, StateEventIdMap, StateMapKey } from '../../types/_common';
import { type PduType } from '../../types/v3-11';

export function getStateMapKey(event: { type: PduType; state_key?: string }): StateMapKey {
	return `${event.type}:${event.state_key ?? ''}`;
}

export function getStateByMapKey<T extends PduType>(
	map: Map<StateMapKey, PersistentEventBase>,
	filter: {
		type: T;
		state_key?: string;
	},
) {
	return map.get(getStateMapKey(filter)) as PersistentEventBase<RoomVersion, T> | undefined;
}

// https://spec.matrix.org/v1.12/rooms/v2/#definitions
//  Power events
export function isPowerEvent(event: PersistentEventBase): boolean {
	return (
		// A power event is a state event with type m.room.power_levels or m.room.join_rules
		event.isPowerLevelEvent() ||
		event.isJoinRuleEvent() ||
		// or a state event with type m.room.member where the membership is leave or ban and the sender does not match the state_key
		(event.isMembershipEvent() && (event.getMembership() === 'leave' || event.getMembership() === 'ban') && event.sender !== event.stateKey)
	);
}

//  Unconflicted state map and conflicted state set.
// State map S_i is {S_1, S_2, S_3, ...}
// iout map takes care of the non-duplication of a set
export function partitionState(events: Readonly<Iterable<PersistentEventBase>>): [StateEventIdMap, Map<StateMapKey, EventID[]>] {
	const unconflictedState: StateEventIdMap = new Map();

	// Note that the unconflicted state map only has one event for each key K, whereas the conflicted state set may contain multiple events with the same key.
	const conflictedStateEventsMap: Map<StateMapKey, EventID[]> = new Map();

	const first = events[Symbol.iterator]().next().value as PersistentEventBase;

	if (!first) {
		// sent empty events
		return [unconflictedState, conflictedStateEventsMap];
	}

	unconflictedState.set(first.getUniqueStateIdentifier(), first.eventId);

	for (const event of events) {
		const { eventId } = event;
		const stateKey = event.getUniqueStateIdentifier();
		// If a given key K is present in every Si with the same value V in each state map
		if (unconflictedState.has(stateKey)) {
			const existingEventid = unconflictedState.get(stateKey);
			if (existingEventid === eventId) {
				// then the pair (K, V) belongs to the unconflicted state map
				continue;
			}

			// values not the same
			unconflictedState.delete(stateKey);

			// conflicted should not have this key at this point
			// add both as each are conflicting with the other
			if (existingEventid) {
				conflictedStateEventsMap.set(stateKey, [existingEventid, eventId]);
			}
		} else if (conflictedStateEventsMap.has(stateKey)) {
			conflictedStateEventsMap.get(stateKey)!.push(eventId);
		} else {
			unconflictedState.set(stateKey, eventId);
		}
	}

	return [unconflictedState, conflictedStateEventsMap];
}

// Auth chain

export interface EventStore {
	getEvents(eventIds: EventID[]): Promise<PersistentEventBase[]>;
}

/*
 *The auth chain of an event E is the set containing all of E’s auth events, all of their auth events, and so on recursively, stretching back to the start of the room. Put differently, these are the events reachable by walking the graph induced by an event’s auth_events links.
 */
export async function getAuthChain(event: PersistentEventBase, store: EventStore): Promise<Set<EventID>> {
	// TODO: central cache for t6his
	const eventIdToAuthChainMap = new Map<EventID, Set<EventID>>(); // do not repeat

	const _getAuthChain = async (event: PersistentEventBase, existingAuthChainPart: Set<EventID>) => {
		const { eventId } = event;

		if (eventIdToAuthChainMap.has(eventId)) {
			return eventIdToAuthChainMap.get(eventId)!;
		}

		const authEvents = await store.getEvents(event.getAuthEventIds());
		if (authEvents.length === 0) {
			eventIdToAuthChainMap.set(eventId, existingAuthChainPart);
			return existingAuthChainPart;
		}

		const authEventIdsSet = new Set(authEvents.map((e) => e.eventId));

		let newAuthChainPart = existingAuthChainPart.union(authEventIdsSet);

		for await (const authEvent of authEvents) {
			const nextAuthChainPart = await _getAuthChain(authEvent, newAuthChainPart);
			if (!nextAuthChainPart) {
				continue;
			}
			newAuthChainPart = newAuthChainPart.union(nextAuthChainPart);
		}

		return newAuthChainPart;
	};

	return _getAuthChain(event, new Set([]));
}

// Auth difference
// NOTE: https://github.com/element-hq/synapse/blob/a25a37002c851ef419d12925a11dd8bf2233470e/docs/auth_chain_difference_algorithm.md
export async function getAuthChainDifference(states: Readonly<Iterable<StateEventIdMap>>, store: EventStore) {
	const authChainSets = [] as Set<EventID>[];

	for await (const state of states) {
		const authChainForState = new Set<EventID>();

		for await (const eventid of state.values()) {
			const [event] = await store.getEvents([eventid]);
			if (!event) {
				console.warn('event not found in store or remote', eventid);
				continue;
			}
			// TODO: deb check this I changed to keep the function behaving as the spec
			for (const authChainEventId of [...(await getAuthChain(event, store)), event.eventId]) {
				authChainForState.add(authChainEventId);
			}
		}

		authChainSets.push(authChainForState);
	}

	const union = authChainSets.reduce((accum, curr) => accum.union(curr), new Set<EventID>());
	const intersection = authChainSets.reduce((accum, curr) => accum?.intersection(curr), authChainSets.shift());

	if (!intersection) {
		return union;
	}

	return union.difference(intersection);
}

export const getEvent = async (
	eventId: EventID,
	{
		store,
		eventMap,
	}: {
		store: EventStore;
		eventMap?: Map<string, PersistentEventBase>; // cache
	},
) => {
	if (eventMap) {
		const event = eventMap.get(eventId);
		if (event) {
			return event;
		}
	}

	{
		const [event] = await store.getEvents([eventId]);
		if (event) {
			return event;
		}
	}

	return null;
};

// Two kinds of graphs
// indegree graph, where the edges are from the parent to the child
// outdegree graph, where the edges are from the child to the parent

export function _kahnsOrder<T>(
	//   edges: T[][],
	{
		// using object to make it clearer to pass in the arguments
		indegreeGraph,
		compareFunc,
	}: {
		// idea is to sort the power events by their preference, who sent it, when it was sent, etc.
		// if i abstract that detail with simple sort idea
		// "which came first" the one with no "indegrees", i.e. no auth events to it, this came first, and so on
		// so the values iun the graph map is the auth events to it
		indegreeGraph: Map<T, Set<T>>;
		compareFunc: (a: T, b: T) => number;
	},
): T[] {
	// make adjacency list
	//   const graph = new Map<T, Set<T>>();

	//   for (const [from, to] of edges) {
	//     if (!graph.has(from)) {
	//       graph.set(from, new Set());
	//     }

	//     graph.get(from)!.add(to);
	//   }

	const result = [] as T[];

	const indegree = new Map<T, number>();

	const reverseIndegreeGraph = new Map() as typeof indegreeGraph;

	for (const [v, edges] of indegreeGraph.entries()) {
		indegree.has(v) || indegree.set(v, edges.size);

		if (!reverseIndegreeGraph.has(v)) {
			reverseIndegreeGraph.set(v, new Set());
		}

		for (const edge of edges) {
			if (!reverseIndegreeGraph.has(edge)) {
				reverseIndegreeGraph.set(edge, new Set([v]));
			} else {
				reverseIndegreeGraph.get(edge)?.add(v);
			}
		}
	}

	const zeroIndegreeQueue = new PriorityQueue(compareFunc);
	// TODO: optimize

	// get all indegrees
	// any key in the graph with no edges has zero indegree
	indegree.keys().forEach((k) => indegree.get(k) === 0 && zeroIndegreeQueue.enqueue(k));

	// While the queue is not empty:
	while (!zeroIndegreeQueue.isEmpty()) {
		const node = zeroIndegreeQueue.pop();
		assert(node !== null, 'undefined element in zeroIndegreeQueue should not happen');

		result.push(node);

		const neighbours = reverseIndegreeGraph.get(node); // T1
		if (!neighbours) {
			continue;
		}

		for (const neighbour of neighbours) {
			// T1
			// if we remove n -> m, i.e. n == node, m == neighbour, we decrement the indegree of m
			const indegreeValue = indegree.get(neighbour) || 0;
			const degree = indegreeValue ? indegreeValue - 1 : 0;
			indegree.set(neighbour, degree);
			if (degree === 0) {
				zeroIndegreeQueue.push(neighbour);
			}
		}
	}

	return result;
}

// sort events by their preference according to primarily the sender's power
export async function reverseTopologicalPowerSort(
	events: Readonly<Iterable<PersistentEventBase>>, // to sort
	conflictedSet: Set<EventID>, // to only include in graph, context
	stateMap: Map<StateMapKey, PersistentEventBase>, // current state
	store: EventStore,
) {
	const graph: Map<EventID, Set<EventID>> = new Map(); // vertex to vertices building the edges

	const eventMap = new Map<EventID, PersistentEventBase>();

	const eventToPowerLevelMap = new Map<EventID, number>();

	const roomCreateEvent = getStateByMapKey(stateMap, {
		type: 'm.room.create',
	});

	if (!roomCreateEvent) {
		throw new Error('room create event not found');
	}

	// event to the auth events
	// so, all edges to each node is a parent

	const buildIndegreeGraph = async (graph: Map<EventID, Set<EventID>>, event: PersistentEventBase) => {
		graph.set(event.eventId, new Set());

		if (event.isPowerLevelEvent()) {
			eventToPowerLevelMap.set(event.eventId, event.toPowerLevelEvent().getPowerLevelForUser(event.sender, roomCreateEvent));
		}

		// auths are the parents, must be on tiop
		for (const authEvent of await store.getEvents(event.getAuthEventIds())) {
			eventMap.set(authEvent.eventId, authEvent);

			if (!eventToPowerLevelMap.has(authEvent.eventId) && authEvent.isPowerLevelEvent()) {
				eventToPowerLevelMap.set(event.eventId, authEvent.toPowerLevelEvent().getPowerLevelForUser(event.sender, roomCreateEvent));
			}

			if (conflictedSet.has(authEvent.eventId)) {
				graph.get(event.eventId)?.add(authEvent.eventId); // add this as an edge

				buildIndegreeGraph(graph, authEvent);
			}
		}

		if (!eventToPowerLevelMap.has(event.eventId)) {
			// use default power level
			eventToPowerLevelMap.set(event.eventId, PowerLevelEvent.fromDefault().getPowerLevelForUser(event.sender, roomCreateEvent));
		}
	};

	for await (const event of events) {
		eventMap.set(event.eventId, event);
		await buildIndegreeGraph(graph, event);
	}

	const compareFunc = (event1Id: EventID, event2Id: EventID): number => {
		const event1 = eventMap.get(event1Id);
		assert(event1, `event not found in store or remote ${event1Id}`);

		const event2 = eventMap.get(event2Id);
		assert(event2, `event not found in store or remote ${event2Id}`);

		// event1 < event2 if
		// ....
		// event1’s sender has greater power level than event2’s sender, when looking at their respective auth_events;

		const sender1PowerLevel = eventToPowerLevelMap.get(event1Id);
		const sender2PowerLevel = eventToPowerLevelMap.get(event2Id);

		if (sender1PowerLevel !== undefined && sender2PowerLevel !== undefined && sender1PowerLevel !== sender2PowerLevel) {
			return sender2PowerLevel - sender1PowerLevel;
		}

		// the senders have the same power level, but x’s origin_server_ts is less than y’s origin_server_ts
		if (event1.originServerTs !== event2.originServerTs) {
			return event1.originServerTs - event2.originServerTs;
		}

		// the senders have the same power level and the events have the same origin_server_ts, but x’s event_id is less than y’s event_id.
		return event1.eventId.localeCompare(event2.eventId);
	};

	return _kahnsOrder({
		indegreeGraph: graph,
		compareFunc,
	});
}

export async function mainlineOrdering(
	events: PersistentEventBase[], // TODO: or take event ids
	store: EventStore,
	// Let P = P0 be an m.room.power_levels event
	powerLevelEvent?: PersistentEventBase<RoomVersion, 'm.room.power_levels'>, // of which we will calculate the mainline
): Promise<PersistentEventBase[]> {
	const getMainline = async (event: PersistentEventBase<RoomVersion, 'm.room.power_levels'>) => {
		const mainline = [] as PersistentEventBase<RoomVersion, 'm.room.power_levels'>[];

		const fn = async (event: PersistentEventBase<RoomVersion, 'm.room.power_levels'>) => {
			const authEvents = await store.getEvents(event.getAuthEventIds());

			// await new Promise((resolve) => setTimeout(resolve, 3000));

			// if (event.event_id.includes("PA2")) {
			// 	console.log("power auth", authEvents);
			// }

			for (const authEvent of authEvents) {
				// when testing this is double the work but meh
				if (authEvent.isPowerLevelEvent()) {
					mainline.push(authEvent);
					return fn(authEvent);
				}
				// Increment i and repeat until Pi has no m.room.power_levels in its auth_events.
				// exit loop and return the mainline
			}

			return mainline;
		};

		return fn(event);
	};

	// this is how we get the mainline of an event
	const mainline: PersistentEventBase<RoomVersion, 'm.room.power_levels'>[] = [];

	if (powerLevelEvent?.isPowerLevelEvent()) {
		mainline.push(...(await getMainline(powerLevelEvent)));
		mainline.unshift(powerLevelEvent); // add the power level event to the mainline
	}

	const mainlinePositions = new Map<EventID, number>(); // NOTE: see comment in the loop

	const mainlineMap = new Map<EventID, number>();

	for (let i = mainline.length - 1, j = 0; i >= 0; i--, j++) {
		mainlineMap.set(
			mainline[i].eventId /* the last event */,
			j /* the more we "walk" the grap the older we get to in the room state, so the older the event, the least depth it has */,
		);
	}

	const getMainlinePositionOfEvent = async (event: PersistentEventBase): Promise<number> => {
		let _event: PersistentEventBase | null = event;

		while (_event) {
			// algorithm follows the same as mainline detection
			if (mainlineMap.has(_event.eventId)) {
				// if in map then this is already a powerLevel event
				return mainlineMap.get(_event.eventId) || 0;
			}

			// eslint-disable-next-line no-await-in-loop
			const authEvents: PersistentEventBase[] = await store.getEvents(_event.getAuthEventIds());

			_event = null;

			for (const authEvent of authEvents) {
				assert(authEvent, 'auth event should not be null, either in our store or remote');

				// Find the smallest index j ≥ 1 for which e_j belongs to the mainline of P.
				if (
					authEvent.isPowerLevelEvent() /* && mainlineMap.has(autheventid) */ /* the check for mainlineMap is already done on the next iteration */
				) {
					// If such a j exists, then e_j = P_i for some unique index i ≥ 0.
					// e_j is current event, _event, the one we are traversing
					_event = authEvent;
					break;
				}
			}
		}

		return 0;
	};

	// Let e = e0 be another event (possibly another m.room.power_levels event)
	// iterating over all, could have been better visualized with a for (let i = 0; i < events.length; i++) loop
	for await (const event of events) {
		// "Now compare these two lists as follows."
		// since we have to compare it doesn't make sense to fetch mainlines of all events here, too expensive, let's try to calculate on the fly
		// we just want the mainline position of the event

		mainlinePositions.set(event.eventId, await getMainlinePositionOfEvent(event));
	}

	// the mainline ordering based on P of a set of events is the ordering
	// from smallest to largest
	//   using the following comparison relation on events: for events x and y, x < y if
	const comparisonFn = (e1: PersistentEventBase, e2: PersistentEventBase) => {
		// the mainline position of x is greater than the mainline position of y
		const e1Position = mainlinePositions.get(e1.eventId);
		const e2Position = mainlinePositions.get(e2.eventId);
		if (e1Position !== undefined && e2Position !== undefined && e1Position < e2Position) return -1;

		// x’s origin_server_ts is less than y’s origin_server_ts
		if (e1.originServerTs !== e2.originServerTs) {
			return e1.originServerTs - e2.originServerTs;
		}

		// x’s event_id is less than y’s event_id.ents: V2Pd
		return e1.eventId.localeCompare(e2.eventId);
	};

	return events.sort(comparisonFn);
}

export type ResolvedState = {
	state: Map<StateMapKey, PersistentEventBase>;
	failedEvents: PersistentEventBase[];
};

// The iterative auth checks algorithm takes as input an initial room state and a sorted list of state events
export async function iterativeAuthChecks(
	events: PersistentEventBase[],
	stateMap: ReadonlyMap<StateMapKey, PersistentEventBase>,
	store: EventStore,
): Promise<State> {
	const newState: State = new Map(stateMap.entries()) as State;

	for await (const event of events) {
		const authEventStateMap: State = new Map();

		const authEvents = await store.getEvents(event.getAuthEventIds());
		for (const authEvent of authEvents) {
			authEventStateMap.set(authEvent.getUniqueStateIdentifier(), authEvent);
		}

		const authEventTypesNeeded = event.getAuthEventStateKeys();

		for (const authEventStateKey of authEventTypesNeeded) {
			const value = newState.get(authEventStateKey);
			if (value) {
				// is the event still valid against new resolved state for the same auth event type
				authEventStateMap.set(authEventStateKey, value);
			}
		}

		try {
			await checkEventAuthWithState(event, authEventStateMap, store);
		} catch (error) {
			console.warn('event not allowed', error);
			if (error instanceof StateResolverAuthorizationError) {
				event.reject(error.code, error.reason, error.rejectedBy);
				continue;
			}

			// if unknown error we halt building new state
			throw error;
		}

		newState.set(event.getUniqueStateIdentifier(), event);
	}

	return newState;
}
