import { PriorityQueue } from "@datastructures-js/priority-queue";
import {
  type EventID,
  PDUType,
  type PDUMembershipEvent,
  type State,
  type StateMapKey,
  type V2Pdu,
  isMembershipEvent,
  type PDUPowerLevelsEvent,
  isCreateEvent,
} from "../../events";

import assert from "node:assert";
import { getPowerLevelForUser, isAllowedEvent } from "./authorization_rules";

export function getStateMapKey(
  event: Pick<V2Pdu, "type" | "state_key">
): StateMapKey {
  return `${event.type}:${event.state_key ?? ""}`;
}

async function getAuthEvents(
  event: V2Pdu,
  {
    store,
    remote,
    state,
  }: { store: EventStore; remote: EventStoreRemote; state: Map<string, V2Pdu> }
): Promise<V2Pdu[]> {
  const authEvents = [] as V2Pdu[];
  if (!event.auth_events) {
    for (const key of getStateTypesForEventAuth(event)) {
      const authEvent = state.get(key);

      if (authEvent && authEvent.event_id !== event.event_id) {
        authEvents.push(authEvent);
      }
    }

    return authEvents;
  }

  for (const authEventId of event.auth_events) {
    const authEvent = await getEvent(authEventId, { store, remote });
    if (!authEvent) {
      console.warn("auth event not found in store or remote", authEventId);
      continue;
    }
    authEvents.push(authEvent);
  }

  return authEvents;
}

// https://spec.matrix.org/v1.12/rooms/v2/#definitions
//  Power events
export function isPowerEvent(event: V2Pdu): boolean {
  return (
    // A power event is a state event with type m.room.power_levels or m.room.join_rules
    event.type === PDUType.PowerLevels ||
    event.type === PDUType.JoinRules ||
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
  events: V2Pdu[]
): [State, Map<string, string[]>] {
  const unconflicted: State = new Map();

  // Note that the unconflicted state map only has one event for each key K, whereas the conflicted state set may contain multiple events with the same key.
  const conflicted: Map<string, string[]> = new Map();

  const first = events.shift();

  if (!first) {
    return [unconflicted, conflicted];
  }

  unconflicted.set(getStateMapKey(first), first.event_id);

  for (const { type, state_key, event_id } of events) {
    const key = getStateMapKey({ type, state_key });
    const value = event_id;
    // If a given key K is present in every Si with the same value V in each state map
    if (unconflicted.has(key)) {
      const existing = unconflicted.get(key)!;
      if (existing === value) {
        // then the pair (K, V) belongs to the unconflicted state map
        continue;
      }

      // values no the same
      unconflicted.delete(key);

      // conflicted should not have this key at this point

      conflicted.set(key, [existing, value]);
    } else if (conflicted.has(value)) {
      // biome-ignore lint/style/noNonNullAssertion: `has` asserts non-null
      conflicted.get(key)!.push(value);
    } else {
      unconflicted.set(key, value);
    }
  }

  return [unconflicted, conflicted];
}

// Auth chain

export interface EventStore {
  getEvents(eventId: string[]): Promise<V2Pdu[]>;
}

export interface EventStoreRemote {
  getEvent(eventId: string): Promise<V2Pdu | null>;
}

/*
 *The auth chain of an event E is the set containing all of E’s auth events, all of their auth events, and so on recursively, stretching back to the start of the room. Put differently, these are the events reachable by walking the graph induced by an event’s auth_events links.
 */
export async function getAuthChain(
  event: V2Pdu,
  {
    store,
    remote,
  }: {
    store: EventStore;
    remote: EventStoreRemote;
  }
): Promise<V2Pdu[]> {
  const auths = event.auth_events;

  // event.type === 'm.room.create'
  if (!auths || auths.length === 0) {
    return [];
  }

  let result = [] as V2Pdu[];

  const storedEventsList = await store.getEvents(auths);

  let eventsNotFoundInStore = [];

  if (storedEventsList.length === 0) {
    eventsNotFoundInStore = auths;
  } else {
    result = result.concat(storedEventsList);

    const storedEventsMap = storedEventsList.reduce((accum, curr) => {
      accum.set(curr.event_id, true);
      return accum;
    }, new Map());

    eventsNotFoundInStore = auths.reduce((accum, curr) => {
      if (!storedEventsMap.has(curr)) {
        accum.push(curr);
      }

      return accum;
    }, [] as string[]);
  }

  for (const eventToFind of eventsNotFoundInStore) {
    const event = await remote.getEvent(eventToFind);
    if (!event) {
      console.warn("event not found in store or remote", eventToFind);
      continue;
    }

    result.push(event);
  }

  return result.reduce(async (accum, curr) => {
    // recursively get all
    const results = await getAuthChain(curr, { store, remote });
    return accum.then((a) => a.concat(results));
  }, Promise.resolve([] as typeof result));
}

// Auth difference
// NOTE: https://github.com/element-hq/synapse/blob/a25a37002c851ef419d12925a11dd8bf2233470e/docs/auth_chain_difference_algorithm.md
export async function getAuthChainDifference(
  events: V2Pdu[],
  {
    store,
    remote,
  }: {
    store: EventStore;
    remote: EventStoreRemote;
  }
) {
  // The auth difference is calculated by first calculating the full auth chain for each state Si,
  //   const authChains = [] as Map<string, V2Pdu>[];

  const _getAuthChain = async (eventId: string) => {
    const [, event] = await store.getEvents([firstEventId]);
    if (!event) {
      console.warn("event not found in store", firstEventId);
      return [];
    }

    const authChain = await getAuthChain(event, { store, remote });
    return authChain.map((e) => e.event_id);
  };

  if (events.length === 0) {
    return new Set<EventID>();
  }

  const { event_id: firstEventId } = events.shift()!;

  const firstAuthChain = await _getAuthChain(firstEventId);

  const authChainUnion = new Set<EventID>(firstAuthChain);

  const authChainIntersection = new Set<EventID>(firstAuthChain);

  // rest of the events
  for (const { event_id: value } of events) {
    const [event] = await store.getEvents([value]);
    if (!event) {
      console.warn("event not found in store", value);
      continue;
    }
    const authChain = await getAuthChain(event, { store, remote });

    // authChains.push(authChain.reduce((accum, curr) => {
    // 	accum.set(curr.event_id, curr);
    // 	return accum;
    // }, new Map()));

    const authChainSet = new Set(authChain.map((e) => e.event_id));

    authChainUnion.union(authChainSet);

    authChainIntersection.intersection(authChainSet);
  }

  //  the auth difference is ∪ C_i − ∩ C_i.
  return authChainUnion.difference(authChainIntersection);
}

const getEvent = async (
  eventId: string,
  {
    store,
    remote,
    eventMap,
  }: {
    store: EventStore;
    remote: EventStoreRemote;
    eventMap?: Map<string, V2Pdu>;
  }
) => {
  if (eventMap) {
    const event = eventMap.get(eventId);
    if (event) {
      return event;
    }
  }

  const [event] = await store.getEvents([eventId]);
  if (event) {
    return event;
  }

  return remote.getEvent(eventId);
};

// Full conflicted set
export async function getFullConflictedSet(
  events: V2Pdu[],
  { store, remote }: { store: EventStore; remote: EventStoreRemote },
  partialConflictedSet?: Map<string, string[]>
): Promise<Set<EventID>> {
  // The full conflicted set is the union of the conflicted state set and the auth difference.
  const [, conflicted] = partialConflictedSet
    ? [null, partialConflictedSet]
    : partitionState(events); // writing like this so i don't ghave to edit anything else from this line forward

  const authChainDiff = await getAuthChainDifference(events, { store, remote });

  console.log("authChainDiff", authChainDiff);
  /*
  const conflictedSet = (await Promise.all(
    conflicted.values().map(async (c) => {
      const events = await Promise.all(
        c.map((cc) => getEvent(cc, { store, remote }))
      );
      return new Set(events.filter(Boolean));
    })
  )) as unknown as Set<V2Pdu>[]; // FIXME

  return conflictedSet.reduce(
    (accum, curr) => accum.union(curr),
    authChainDiff
  );
 */

  return authChainDiff.union(
    new Set(conflicted.values().reduce((accum, curr) => accum.concat(curr), []))
  );
}

export interface Queue<T> {
  enqueue(item: T): Queue<T>;
  push(item: T): Queue<T>;
  pop(): T | null;
  isEmpty(): boolean;
}

export function _kahnsOrder<T, P extends Queue<T>>(
  //   edges: T[][],
  graph: Map<T, Set<T>>,
  compareFunc: (a: T, b: T) => number,
  queueClass: new (compare: typeof compareFunc) => P
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

  for (const [v, edges] of graph.entries()) {
    indegree.has(v) || indegree.set(v, 0);
    for (const edge of edges) {
      if (indegree.has(edge)) {
        indegree.set(edge, indegree.get(edge)! + 1);
      } else {
        indegree.set(edge, 1);
      }
    }
  }

  const zeroIndegreeQueue: Queue<T> = new queueClass(compareFunc);
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
      "undefined element in zeroIndegreeQueue should not happen"
    );

    result.push(node);

    const neighbours = graph.get(node);
    if (!neighbours) {
      continue;
    }

    for (const neighbour of neighbours) {
      const degree = indegree.get(neighbour)! - 1;
      indegree.set(neighbour, degree);
      if (degree === 0) {
        zeroIndegreeQueue.push(neighbour);
      }
    }
  }

  return result;
}

// trying to sort power events
export async function lexicographicalTopologicalSort<T>(
  graph: Map<string, Set<string>>,
  authEventMap: Map<string, V2Pdu>,
  { store, remote }: { store: EventStore; remote: EventStoreRemote }
) {
  const eventMap = new Map<string, V2Pdu>();

  // set up cache map
  for (const [key, value] of graph.entries()) {
    const event = await getEvent(key, { store, remote });
    if (!event) {
      console.warn("event not found in store or remote", key);
      continue;
    }
    eventMap.set(key, event);

    for (const v of value) {
      if (eventMap.has(v)) {
        continue;
      }

      const event = await getEvent(v, { store, remote });
      if (!event) {
        console.warn("event not found in store or remote", v);
        continue;
      }
      eventMap.set(v, event);
    }
  }

  const compareFunc = (event1Id: string, event2Id: string): number => {
    const event1 = eventMap.get(event1Id);
    const event2 = eventMap.get(event2Id);

    assert(
      event1 && event2,
      `event not found in store or remote ${event1Id} ${event2Id}`
    );

    // event1 < event2 if
    // ....
    // event1’s sender has greater power level than event2’s sender, when looking at their respective auth_events;

    if (
      getPowerLevelForUser(event1.sender, authEventMap) >
      getPowerLevelForUser(event2.sender, authEventMap)
    ) {
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

  // The reverse topological power ordering can be found by sorting the events using Kahn’s algorithm for topological sorting, and at each step selecting, among all the candidate vertices, the smallest vertex using the above comparison relation.

  const sorted = _kahnsOrder<string, PriorityQueue<string>>(
    graph,
    compareFunc,
    PriorityQueue
  );

  // PA2, PB, T5

  return sorted;
}

export async function reverseTopologicalPowerSort(
  events: V2Pdu[],
  { store, remote }: { store: EventStore; remote: EventStoreRemote }
) {
  const graph: Map<string, Set<string>> = new Map(); // vertex to vertices building the edges

  const authEventMap = new Map<string, V2Pdu>();

  const buildGraph = async (graph: Map<string, Set<string>>, event: V2Pdu) => {
    if (!graph.has(event.event_id)) {
      graph.set(event.event_id, new Set());
    }

    for (const authEvent of await getAuthEvents(event, {
      store,
      remote,
      state: authEventMap,
    })) {
      authEventMap.set(authEvent.event_id, authEvent);

      graph.get(event.event_id)!.add(authEvent.event_id); // add this as an edge

      buildGraph(graph, authEvent);
    }
  };

  for (const event of events) {
    await buildGraph(graph, event);
  }

  return lexicographicalTopologicalSort(graph, authEventMap, { store, remote });
}

// FIXME:
export async function mainlineOrdering(
  events: V2Pdu[], // TODO: or take event ids
  // Let P = P0 be an m.room.power_levels event
  powerLevelEvent: PDUPowerLevelsEvent, // of which we will calculate the mainline
  authEventMap: Map<string, V2Pdu>,
  {
    store,
    remote,
  }: {
    store: EventStore;
    remote: EventStoreRemote;
  }
): Promise<V2Pdu[]> {
  console.log("mainlineOrdering", events);
  const getMainline = async (event: V2Pdu) => {
    const mainline = [] as V2Pdu[];

    const fn = async (event: V2Pdu) => {
      const authEvents = await getAuthEvents(event, {
        store,
        remote,
        state: authEventMap,
      });

      for (const authEvent of authEvents) {
        // when testing this is double the work but meh
        if (authEvent.type === PDUType.PowerLevels) {
          mainline.push(event);
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

  console.log("mainline", mainline);

  assert(mainline && mainline.length > 0, "mainline should not be empty");

  const mainlinePositions = new Map<EventID, number>(); // NOTE: see comment in the loop

  const mainlineMap = new Map<EventID, number>();

  for (let i = mainline.length - 1, j = 0; i >= 0; i--, j++) {
    mainlineMap.set(
      mainline[i].event_id /* the last event */,
      j /* the more we "walk" the grap the older we get to in the room state, so the older the event, the least depth it has */
    );
  }

  console.log("mainlineMap", mainlineMap);

  const getMainlinePositionOfEvent = async (event: V2Pdu): Promise<number> => {
    let _event: V2Pdu | null = event;

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
          "auth event should not be null, either in our store or remote"
        );

        // Find the smallest index j ≥ 1 for which e_j belongs to the mainline of P.
        if (
          authEvent.type ===
          PDUType.PowerLevels /* && mainlineMap.has(autheventid) */ /* the check for mainlineMap is already done on the next iteration */
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
      await getMainlinePositionOfEvent(event)
    );
  }

  console.log("mainlinePositions", mainlinePositions);

  // the mainline ordering based on P of a set of events is the ordering
  // from smallest to largest
  //   using the following comparison relation on events: for events x and y, x < y if
  const comparisonFn = (e1: V2Pdu, e2: V2Pdu) => {
    // the mainline position of x is greater than the mainline position of y
    if (
      mainlinePositions.get(e1.event_id)! > mainlinePositions.get(e2.event_id)!
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
  state: Map<string, V2Pdu>,
  events: V2Pdu[],
  { store, remote }: { store: EventStore; remote: EventStoreRemote }
) {
  console.log("iterativeAuthChecks", events);
  const newState = new Map<string, V2Pdu>(state.entries().toArray());
  for (const event of events) {
    const authEventStateMap = new Map<string, V2Pdu>();
    for (const authEvent of await getAuthEvents(event, {
      store,
      remote,
      state: newState,
    })) {
      authEventStateMap.set(getStateMapKey(authEvent), authEvent);
    }

    console.log("authEventStateMap", authEventStateMap);

    if (isAllowedEvent(event, authEventStateMap)) {
      newState.set(getStateMapKey(event), event);
    }
  }

  return newState;
}

function getStateTypesForEventAuth(event: V2Pdu): string[] {
  if (isCreateEvent(event)) {
    return [];
  }

  const authTypes = [
    getStateMapKey({ type: PDUType.PowerLevels }),
    getStateMapKey({ type: PDUType.Member, state_key: event.sender }),
    getStateMapKey({ type: PDUType.Create }),
  ];

  if (
    isMembershipEvent(event) &&
    ["join", "knock", "invite"].includes(event.content.membership)
  ) {
    authTypes.push(getStateMapKey({ type: PDUType.JoinRules }));
  }

  return authTypes;
}

// https://spec.matrix.org/v1.12/rooms/v2/#algorithm
export async function resolveStateV2Plus(
  events: V2Pdu[],
  { store, remote }: { store: EventStore; remote: EventStoreRemote }
) {
  // memory o'memory
  const eventMap = new Map<string, V2Pdu>();

  const stateMap = new Map<string, V2Pdu>();

  const stateEvents = [];

  for (const event of events) {
    eventMap.set(event.event_id, event);
    if (event.type !== PDUType.Message) {
      stateMap.set(getStateMapKey(event), event);
      stateEvents.push(event);
    }
  }

  // 1. Select the set X of all power events that appear in the full conflicted set.

  const [unconflicted, conflicted] = partitionState(stateEvents);

  console.log("unconflicted", unconflicted);
  console.log("conflicted", conflicted);

  if (conflicted.size === 0) {
    // no conflicted state, return the unconflicted state
    return unconflicted.keys().reduce((accum, curr) => {
      const event = stateMap.get(curr);
      assert(event, "event should not be null");
      accum.set(curr, event);
      return accum;
    }, new Map<string, V2Pdu>());
  }

  const fullConflictedSet = await getFullConflictedSet(
    stateEvents,
    {
      store,
      remote,
    },
    conflicted
  );

  console.log("fullConflictedSet", fullConflictedSet);

  const powerEvents = [] as V2Pdu[];

  for (const eventid of fullConflictedSet) {
    const event = eventMap.get(eventid);
    if (event && isPowerEvent(event)) {
      powerEvents.push(event);
    }
  }

  console.log("powerEvents partial", powerEvents);

  //  For each such power event P, enlarge X by adding the events in the auth chain of P which also belong to the full conflicted set.

  for (const event of powerEvents) {
    const authChain = await getAuthChain(event, { store, remote });
    // when testing this authChain will be empty
    // so we fetch those manually from existing state events
    if (authChain.length === 0) {
      for (const key of getStateTypesForEventAuth(event)) {
        const authEvent = stateMap.get(key);
        if (authEvent) {
          authChain.push(authEvent);
        }
      }
    }

    for (const authEvent of authChain) {
      if (
        fullConflictedSet.has(authEvent.event_id) &&
        !powerEvents.find((e) => e.event_id === authEvent.event_id) &&
        isPowerEvent(authEvent)
      ) {
        powerEvents.push(authEvent);
      }
    }
  }

  console.log("powerEvents", powerEvents);

  // Sort X into a list using the reverse topological power ordering.
  const sortedPowerEvents = await reverseTopologicalPowerSort(powerEvents, {
    store,
    remote,
  });

  console.log("sortedPowerEvents", sortedPowerEvents);

  // 2. Apply the iterative auth checks algorithm, starting from the unconflicted state map, to the list of events from the previous step to get a partially resolved state.
  const initialState = new Map<string, V2Pdu>();
  for (const [key, eventId] of unconflicted) {
    const event = await getEvent(eventId, { store, remote });
    assert(event, "event should not be null");
    initialState.set(key, event);
  }

  console.log("initialState", initialState);

  const partiallyResolvedState = await iterativeAuthChecks(
    initialState,
    sortedPowerEvents.map((e) => eventMap.get(e)!).filter(Boolean),
    { store, remote }
  );

  console.log("partiallyResolvedState", partiallyResolvedState);

  // 3. Take all remaining events that weren’t picked in step 1 and order them by the mainline ordering based on the power level in the partially resolved state obtained in step 2.
  const remainingEvents = fullConflictedSet
    .values()
    .filter((e) => !sortedPowerEvents.includes(e))
    .toArray();

  console.log("remainingEvents", remainingEvents);

  const powerLevelEvent = partiallyResolvedState.get(
    getStateMapKey({ type: PDUType.PowerLevels })
  ) as PDUPowerLevelsEvent | undefined;

  assert(powerLevelEvent, "power level event should not be null");

  const orderedRemainingEvents = await mainlineOrdering(
    remainingEvents.map((e) => eventMap.get(e)!).filter(Boolean),
    powerLevelEvent,
    stateMap,
    { store, remote }
  );

  console.log("partiallyResolvedState", partiallyResolvedState);
  console.log("orderedRemainingEvents", orderedRemainingEvents);

  // 4. Apply the iterative auth checks algorithm on the partial resolved state and the list of events from the previous step.
  const finalState = await iterativeAuthChecks(
    partiallyResolvedState,
    orderedRemainingEvents,
    { store, remote }
  );

  console.log("finalState", finalState);

  // 5. Update the result by replacing any event with the event with the same key from the unconflicted state map, if such an event exists, to get the final resolved state.
  for (const [key, value] of unconflicted) {
    if (finalState.has(key)) {
      const event = await getEvent(value, { store, remote });
      assert(event, "event should not be null");
      finalState.set(key, event);
    }
  }

  return finalState;
}
