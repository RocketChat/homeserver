import { PriorityQueue } from "@datastructures-js/priority-queue";
import type { EventID, State, StateMapKey } from "../../types/_common";
import {
	PduTypeRoomMember,
	isMembershipEvent,
	isCreateEvent,
	PduTypeRoomPowerLevels,
	PduTypeRoomJoinRules,
	PduTypeRoomCreate,
	type PduCreateEventContent,
} from "../../types/v1";

import assert from "node:assert";
import { getPowerLevelForUser, isAllowedEvent } from "./authorization_rules";
import type { PduPowerLevelsEventV3Content, PduV3 } from "../../types/v3";

export function getStateMapKey(
	event: Pick<PduV3, "type" | "state_key">,
): StateMapKey {
	return `${event.type}:${event.state_key ?? ""}` as const;
}

export async function getAuthEvents(
	event: PduV3,
	{
		store,
		remote,
		state,
	}: {
		store: EventStore;
		remote: EventStoreRemote;
		state: Map<StateMapKey, PduV3>;
	},
): Promise<PduV3[]> {
	const authEvents = new Map<StateMapKey, PduV3>();

	for (const authEventId of event.auth_events) {
		const authEvent = await getEvent(authEventId, { store, remote });
		if (!authEvent) {
			console.warn("auth event not found in store or remote", authEventId);
			continue;
		}
		authEvents.set(getStateMapKey(authEvent), authEvent);
	}

	for (const statekey of getStateTypesForEventAuth(event)) {
		const authEvent = state.get(statekey);
		if (authEvent && event.event_id !== authEvent.event_id) {
			// replace existing events
			authEvents.set(getStateMapKey(authEvent), authEvent);
		}
	}

	return authEvents.values().toArray();
}

// https://spec.matrix.org/v1.12/rooms/v2/#definitions
//  Power events
export function isPowerEvent(event: PduV3): boolean {
	return (
		// A power event is a state event with type m.room.power_levels or m.room.join_rules
		event.type === PduTypeRoomPowerLevels ||
		event.type === PduTypeRoomJoinRules ||
		// or a state event with type m.room.member where the membership is leave or ban and the sender does not match the state_key
		(isMembershipEvent(event) &&
			(event.content.membership === "leave" ||
				event.content.membership === "ban") &&
			event.sender !== event.state_key)
	);
}

//  Unconflicted state map and conflicted state set.
// State map S_i is {S_1, S_2, S_3, ...}
// iout map takes care of the non-duplication of a set
export function partitionState(
	events: Readonly<Iterable<PduV3>>,
): [State, Map<StateMapKey, EventID[]>] {
	const unconflictedState: State = new Map();

	// Note that the unconflicted state map only has one event for each key K, whereas the conflicted state set may contain multiple events with the same key.
	const conflictedStateEventsMap: Map<StateMapKey, EventID[]> = new Map();

	const first = events[Symbol.iterator]().next().value as PduV3;

	if (!first) {
		// sent empty events
		return [unconflictedState, conflictedStateEventsMap];
	}

	unconflictedState.set(getStateMapKey(first), first.event_id);

	for (const { type, state_key, event_id } of events) {
		const key = getStateMapKey({ type, state_key });
		const value = event_id;
		// If a given key K is present in every Si with the same value V in each state map
		if (unconflictedState.has(key)) {
			const existing = unconflictedState.get(key)!;
			if (existing === value) {
				// then the pair (K, V) belongs to the unconflicted state map
				continue;
			}

			// values not the same
			unconflictedState.delete(key);

			// conflicted should not have this key at this point
			// add both as each are conflicting with the other

			conflictedStateEventsMap.set(key, [existing, value]);
		} else if (conflictedStateEventsMap.has(key)) {
			// biome-ignore lint/style/noNonNullAssertion: `has` asserts non-null
			conflictedStateEventsMap.get(key)!.push(value);
		} else {
			unconflictedState.set(key, value);
		}
	}

	return [unconflictedState, conflictedStateEventsMap];
}

// Auth chain

export interface EventStore {
	getEvents(eventId: string[]): Promise<PduV3[]>;
}

export interface EventStoreRemote {
	getEvent(eventId: string): Promise<PduV3 | null>;
}

/*
 *The auth chain of an event E is the set containing all of E’s auth events, all of their auth events, and so on recursively, stretching back to the start of the room. Put differently, these are the events reachable by walking the graph induced by an event’s auth_events links.
 */
export async function getAuthChain(
	event: PduV3,
	{
		store,
		remote,
	}: {
		store: EventStore;
		remote: EventStoreRemote;
		eventMap?: Map<EventID, PduV3>; // cache
	},
): Promise<Set<PduV3["event_id"]>> {
	// const auths = event.auth_events;

	// event.type === 'm.room.create'
	if (event.auth_events.length === 0) {
		return new Set();
	}

	const eventIdToAuthChainMap = new Map<EventID, Set<EventID>>(); // do not repeat

	const _getAuthChain = async (
		event: PduV3,
		existingAuthChainPart: Set<EventID>,
	) => {
		if (eventIdToAuthChainMap.has(event.event_id)) {
			return eventIdToAuthChainMap.get(event.event_id)!;
		}

		if (event.auth_events.length === 0) {
			eventIdToAuthChainMap.set(event.event_id, existingAuthChainPart);
			return existingAuthChainPart;
		}

		const authEvents = await getAuthEvents(event, {
			store,
			remote,
			state: new Map(),
		});

		const authEventIds = new Set(authEvents.map((e) => e.event_id));

		let newAuthChainPart = existingAuthChainPart.union(authEventIds);

		for (const authEvent of authEvents) {
			const nextAuthChainPart = await _getAuthChain(
				authEvent,
				newAuthChainPart,
			);
			newAuthChainPart = newAuthChainPart.union(nextAuthChainPart);
		}

		return newAuthChainPart;
	};

	return _getAuthChain(event, new Set([event.event_id]));
}

// Auth difference
// NOTE: https://github.com/element-hq/synapse/blob/a25a37002c851ef419d12925a11dd8bf2233470e/docs/auth_chain_difference_algorithm.md
export async function getAuthChainDifference(
	states: Readonly<Iterable<State>>,
	eventMap: Map<string, PduV3>, // cache
	{
		store,
		remote,
	}: {
		store: EventStore;
		remote: EventStoreRemote;
	},
) {
	const authChainSets = [] as Set<EventID>[];

	for (const state of states) {
		const authChainForState = new Set<EventID>();

		for (const eventid of state.values()) {
			const event =
				eventMap.get(eventid) ?? (await getEvent(eventid, { store, remote }));
			if (!event) {
				console.warn("event not found in store or remote", eventid);
				continue;
			}

			for (const authChainEventId of await getAuthChain(event, {
				store,
				remote,
			})) {
				authChainForState.add(authChainEventId);
			}
		}

		authChainSets.push(authChainForState);
	}

	const union = authChainSets.reduce(
		(accum, curr) => accum.union(curr),
		new Set<EventID>(),
	);
	const intersection = authChainSets.reduce(
		(accum, curr) => accum.intersection(curr),
		authChainSets.shift()!,
	);

	return union.difference(intersection);
}

export const getEvent = async (
	eventId: EventID,
	{
		store,
		remote,
		eventMap,
	}: {
		store: EventStore;
		remote: EventStoreRemote;
		eventMap?: Map<string, PduV3>; // cache
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
			eventMap?.set(eventId, event);
			return event;
		}
	}

	const event = await remote.getEvent(eventId);
	if (event) {
		eventMap?.set(eventId, event);
		return event;
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
				reverseIndegreeGraph.get(edge)!.add(v);
			}
		}
	}

	const zeroIndegreeQueue = new PriorityQueue(compareFunc);
	// TODO: optimize

	// get all indegrees
	// any key in the graph with no edges has zero indegree
	// biome-ignore lint/complexity/noForEach: <explanation>
	indegree
		.keys()
		.forEach((k) => indegree.get(k) === 0 && zeroIndegreeQueue.enqueue(k));

	// While the queue is not empty:
	while (!zeroIndegreeQueue.isEmpty()) {
		const node = zeroIndegreeQueue.pop();
		assert(
			node !== null,
			"undefined element in zeroIndegreeQueue should not happen",
		);

		result.push(node);

		const neighbours = reverseIndegreeGraph.get(node); // T1
		if (!neighbours) {
			continue;
		}

		for (const neighbour of neighbours) {
			// T1
			// if we remove n -> m, i.e. n == node, m == neighbour, we decrement the indegree of m
			const degree = indegree.get(neighbour)! - 1;
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
	events: Readonly<Iterable<PduV3>>, // to sort
	conflictedSet: Set<EventID>, // to only include in graph, context
	stateMap: Map<StateMapKey, PduV3>, // current state
	{ store, remote }: { store: EventStore; remote: EventStoreRemote },
) {
	const graph: Map<EventID, Set<EventID>> = new Map(); // vertex to vertices building the edges

	const eventMap = new Map<EventID, PduV3>();

	// event to the auth events
	// so, all edges to each node is a parent

	const buildIndegreeGraph = async (
		graph: Map<EventID, Set<EventID>>,
		event: PduV3,
	) => {
		graph.set(event.event_id, new Set());

		// auths are the parents, must be on tiop
		for (const authEvent of await getAuthEvents(event, {
			store,
			remote,
			state: stateMap,
		})) {
			eventMap.set(authEvent.event_id, authEvent);

			if (conflictedSet.has(authEvent.event_id)) {
				graph.get(event.event_id)!.add(authEvent.event_id); // add this as an edge

				buildIndegreeGraph(graph, authEvent);
			}
		}
	};

	for (const event of events) {
		eventMap.set(event.event_id, event);
		await buildIndegreeGraph(graph, event);
	}

	const roomCreateEvent = stateMap.get(
		getStateMapKey({ type: PduTypeRoomCreate }),
	) as (PduV3 & PduCreateEventContent) | null;

	if (!roomCreateEvent) {
		throw new Error("room create event not found");
	}

	const compareFunc = (event1Id: EventID, event2Id: EventID): number => {
		const event1 = eventMap.get(event1Id);
		assert(event1, `event not found in store or remote ${event1Id}`);

		const event2 = eventMap.get(event2Id);
		assert(event2, `event not found in store or remote ${event2Id}`);

		// event1 < event2 if
		// ....
		// event1’s sender has greater power level than event2’s sender, when looking at their respective auth_events;
		//
		const sender1PowerLevel = getPowerLevelForUser(
			event1.sender,
			eventMap.get(event1Id) as PduV3 & PduPowerLevelsEventV3Content,
			roomCreateEvent,
		);

		const sender2PowerLevel = getPowerLevelForUser(
			event2.sender,
			eventMap.get(event2Id) as PduV3 & PduPowerLevelsEventV3Content,
			roomCreateEvent,
		);

		// more power, earlier the position
		if (sender1PowerLevel > sender2PowerLevel) {
			return -1;
		}

		// the senders have the same power level, but x’s origin_server_ts is less than y’s origin_server_ts
		if (event1.origin_server_ts < event2.origin_server_ts) {
			return -1;
		}

		// the senders have the same power level and the events have the same origin_server_ts, but x’s event_id is less than y’s event_id.
		if (event1.event_id < event2.event_id) {
			return -1;
		}

		return 1;
	};

	return _kahnsOrder({
		indegreeGraph: graph,
		compareFunc,
	});
}

// FIXME:
export async function mainlineOrdering(
	events: PduV3[], // TODO: or take event ids
	// Let P = P0 be an m.room.power_levels event
	powerLevelEvent: PduV3 & PduPowerLevelsEventV3Content, // of which we will calculate the mainline
	authEventMap: Map<StateMapKey, PduV3>,
	{
		store,
		remote,
	}: {
		store: EventStore;
		remote: EventStoreRemote;
	},
): Promise<PduV3[]> {
	const getMainline = async (event: PduV3) => {
		const mainline = [] as PduV3[];

		const fn = async (event: PduV3) => {
			const authEvents = await getAuthEvents(event, {
				store,
				remote,
				state: authEventMap,
			});

			// await new Promise((resolve) => setTimeout(resolve, 3000));

			// if (event.event_id.includes("PA2")) {
			// 	console.log("power auth", authEvents);
			// }

			for (const authEvent of authEvents) {
				// when testing this is double the work but meh
				if (authEvent.type === PduTypeRoomPowerLevels) {
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
	const mainline = await getMainline(powerLevelEvent);

	mainline.unshift(powerLevelEvent); // add the power level event to the mainline

	assert(mainline && mainline.length > 0, "mainline should not be empty");

	const mainlinePositions = new Map<EventID, number>(); // NOTE: see comment in the loop

	const mainlineMap = new Map<EventID, number>();

	for (let i = mainline.length - 1, j = 0; i >= 0; i--, j++) {
		mainlineMap.set(
			mainline[i].event_id /* the last event */,
			j /* the more we "walk" the grap the older we get to in the room state, so the older the event, the least depth it has */,
		);
	}

	const getMainlinePositionOfEvent = async (event: PduV3): Promise<number> => {
		let _event: PduV3 | null = event;

		while (_event) {
			// algorithm follows the same as mainline detection
			if (mainlineMap.has(_event.event_id)) {
				// if in map then this is already a powerLevel event
				return mainlineMap.get(_event.event_id)!;
			}

			const authEvents = await getAuthEvents(_event, {
				store,
				remote,
				state: authEventMap,
			});

			_event = null;

			for (const authEvent of authEvents) {
				assert(
					authEvent,
					"auth event should not be null, either in our store or remote",
				);

				// Find the smallest index j ≥ 1 for which e_j belongs to the mainline of P.
				if (
					authEvent.type ===
					PduTypeRoomPowerLevels /* && mainlineMap.has(autheventid) */ /* the check for mainlineMap is already done on the next iteration */
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
	for (const event of events) {
		// "Now compare these two lists as follows."
		// since we have to compare it doesn't make sense to fetch mainlines of all events here, too expensive, let's try to calculate on the fly
		// we just want the mainline position of the event

		mainlinePositions.set(
			event.event_id,
			await getMainlinePositionOfEvent(event),
		);
	}

	// the mainline ordering based on P of a set of events is the ordering
	// from smallest to largest
	//   using the following comparison relation on events: for events x and y, x < y if
	const comparisonFn = (e1: PduV3, e2: PduV3) => {
		// the mainline position of x is greater than the mainline position of y
		if (
			mainlinePositions.get(e1.event_id)! < mainlinePositions.get(e2.event_id)!
		) {
			return -1;
		}

		// x’s origin_server_ts is less than y’s origin_server_ts
		if (e1.origin_server_ts < e2.origin_server_ts) {
			return -1;
		}

		// x’s event_id is less than y’s event_id.ents: V2Pd
		if (e1.event_id < e2.event_id) {
			return -1;
		}

		return 1;
	};

	return events.sort(comparisonFn);
}

// The iterative auth checks algorithm takes as input an initial room state and a sorted list of state events
export async function iterativeAuthChecks(
	events: PduV3[],
	stateMap: Map<StateMapKey, PduV3>,
	{ store, remote }: { store: EventStore; remote: EventStoreRemote },
) {
	const newState = new Map<StateMapKey, PduV3>(stateMap.entries());
	for (const event of events) {
		const authEventStateMap = new Map<StateMapKey, PduV3>();
		for (const authEvent of await getAuthEvents(event, {
			store,
			remote,
			state: newState,
		})) {
			authEventStateMap.set(getStateMapKey(authEvent), authEvent);
		}

		if (isAllowedEvent(event, authEventStateMap)) {
			newState.set(getStateMapKey(event), event);
		}
	}

	return newState;
}

export function getStateTypesForEventAuth(event: PduV3): StateMapKey[] {
	if (isCreateEvent(event)) {
		return [];
	}

	const authTypes = [
		getStateMapKey({ type: PduTypeRoomPowerLevels }),
		getStateMapKey({ type: PduTypeRoomMember, state_key: event.sender }),
		getStateMapKey({ type: PduTypeRoomCreate }),
	];

	if (
		isMembershipEvent(event) &&
		["join", "knock", "invite"].includes(event.content.membership)
	) {
		authTypes.push(getStateMapKey({ type: PduTypeRoomJoinRules }));
	}

	return authTypes;
}
