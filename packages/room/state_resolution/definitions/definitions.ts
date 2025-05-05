import {
  PDUType,
  type PDUMembershipEvent,
  type State,
  type StateMapKey,
  type V2Pdu,
} from "../../events";

import assert from "node:assert";

function getStateMapKey(event: V2Pdu): StateMapKey {
  return `${event.type}:${event.state_key ?? ""}`;
}

export function isMembershipEvent(event: V2Pdu): event is PDUMembershipEvent {
  return event.type === PDUType.Member;
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
export function partitionState(state: State): [State, Map<string, string[]>] {
  const unconflicted: State = new Map();

  // Note that the unconflicted state map only has one event for each key K, whereas the conflicted state set may contain multiple events with the same key.
  const conflicted: Map<string, string[]> = new Map();

  const stateSet = state.entries();

  const first = stateSet.next().value;

  if (!first) {
    return [unconflicted, conflicted];
  }

  unconflicted.set(first[0], first[1]);

  for (const [key, value] of stateSet) {
    // If a given key K is present in every Si with the same value V in each state map
    if (unconflicted.has(key)) {
      const existing = unconflicted.get(key);
      if (existing === value) {
        // then the pair (K, V) belongs to the unconflicted state map
        continue;
      }

      // values no the same
      unconflicted.delete(key);

      // conflicted should not have this key at this point

      conflicted.set(key, [value]);
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
  if (auths.length === 0) {
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
      // TODO what to do
      //
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
  state: State,
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

  const authChains = [] as Set<V2Pdu>[];

  const stateIt = state.entries();

  for (const [_, value] of stateIt) {
    const [event] = await store.getEvents([value]);
    if (!event) {
      // TODO what to do
      continue;
    }
    const authChain = await getAuthChain(event, { store, remote });

    // authChains.push(authChain.reduce((accum, curr) => {
    // 	accum.set(curr.event_id, curr);
    // 	return accum;
    // }, new Map()));

    authChains.push(new Set(authChain));
  }

  //  the auth difference is ∪ C_i − ∩ C_i.

  const union = authChains.reduce(
    (accum, curr) => accum.union(curr),
    authChains.pop()!
  );

  const intersection = authChains.reduce(
    (accum, curr) => accum.intersection(curr),
    authChains.pop()!
  );

  return union.difference(intersection);
}

const getEvent = async (
  eventId: string,
  { store, remote }: { store: EventStore; remote: EventStoreRemote }
) => {
  const [event] = await store.getEvents([eventId]);
  if (event) {
    return event;
  }

  return remote.getEvent(eventId);
};

// Full conflicted set
export async function getFullConflictedSet(
  state: State,
  { store, remote }: { store: EventStore; remote: EventStoreRemote }
): Promise<Set<V2Pdu>> {
  // The full conflicted set is the union of the conflicted state set and the auth difference.
  const [, conflicted] = partitionState(state);
  const authChainDiff = await getAuthChainDifference(state, { store, remote });

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
}

// generic for testing
// I don't think this is right
export function lexicographicalTopologicalSort<T>(
  graph: Map<string, Set<string>>,
  compareFunc: (event1: T, event2: T) => boolean
) {
  // L ← Empty list that will contain the sorted elements
  const result = [];

  // S ← Set of all nodes with no incoming edge
  const zeroIndegree = [];

  const reverseGraph = new Map<string, Set<string>>();

  const set = (it?: any) => new Set(it) as Set<string>;

  for (const [v, edges] of graph.entries()) {
    // no incoming edge, see comment below
    if (edges.size === 0) {
      zeroIndegree.push(v);
    }

    /*
     * our graph is in reverse direction.
     * i.e. in [v_1] => [v_2, v_3], [v_3] => [v_4]
     * the edges are the predecessor of the vertices.
     * v_4 -> v_3 -> v_1
     *        v_2 -> v_1
     * for kahn's NOTE https://en.wikipedia.org/wiki/Topological_sorting#Kahn
     * "for each node m with an edge e from n to m do"
     * we need the reverse of our reverse graph
     */

    reverseGraph.set(v, set());

    for (const edge of edges) {
      // edge -> vertex
      if (reverseGraph.has(edge)) {
        reverseGraph.get(edge)!.add(v);
      } else {
        reverseGraph.set(edge, set(v));
      }
    }
  }

  // while S is not empty do
  while (zeroIndegree.length) {
    const node = zeroIndegree.shift();

    assert(node, "undefined element in zeroIndegree should not happen");

    // add n to L
    result.push(node);

    // for each node m with an edge e from n to m do
    // n -> m, we get this from our reverseGraph

    const parents = reverseGraph.get(node);
    assert(
      parents,
      "parents should not be undefined and should be a set of strings"
    );

    for (const parent of parents) {
      // remove edge e from the graph
      reverseGraph.delete(parent);
      if (reverseGraph.get(parent)?.size === 0) {
        zeroIndegree.push(parent);
      }
    }

    assert(reverseGraph.size === 0, "graph should not have any edges left");

    return result;
  }
}

export async function reverseTopologicalPowerSort(
  events: Set<V2Pdu>,
  { store, remote }: { store: EventStore; remote: EventStoreRemote }
) {
  const graph: Map<string, Set<string>> = new Map(); // vertex to vertices building the edges

  const buildGraph = async (graph: Map<string, Set<string>>, event: V2Pdu) => {
    if (!graph.has(event.event_id)) {
      graph.set(event.event_id, new Set());
    }

    for (const authEventId of event.auth_events) {
      const authevent = await getEvent(authEventId, { store, remote });
      if (!authevent) {
        // TODO
        continue;
      }

      graph.get(event.event_id)!.add(authEventId); // add this as an edge

      buildGraph(graph, authevent);
    }
  };

  for (const event of events) {
    await buildGraph(graph, event);
  }

  console.log(graph.entries());
}
