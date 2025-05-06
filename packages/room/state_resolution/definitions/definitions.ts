import { PriorityQueue } from "@datastructures-js/priority-queue";
import {
  type EventID,
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
  assert;
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

// generic for testing
export function lexicographicalTopologicalSort<T>(
  graph: Map<string, Set<string>>
) {
  const getPowerLevel = (sender: string): number => {
    // TODO: implement
    return 0;
  };
  const compareFunc = (event1: V2Pdu, event2: V2Pdu): number => {
    // event1 < event2 if
    // ....
    // event1’s sender has greater power level than event2’s sender, when looking at their respective auth_events;

    if (getPowerLevel(event1.sender) > getPowerLevel(event2.sender)) {
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

  const sorted = _kahnsOrder<V2Pdu, PriorityQueue<V2Pdu>>(
    graph,
    compareFunc,
    PriorityQueue
  );

  return sorted;
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

  return lexicographicalTopologicalSort(graph);
}

// https://spec.matrix.org/v1.12/rooms/v2/#algorithm
export async function resolveStateV2Plus(
  state: State,
  { store, remote }: { store: EventStore; remote: EventStoreRemote }
) {
  // Select the set X of all power events that appear in the full conflicted set. For each such power event P, enlarge X by adding the events in the auth chain of P which also belong to the full conflicted set. Sort X into a list using the reverse topological power ordering.

  const fullConflictedSet = await getFullConflictedSet(state, {
    store,
    remote,
  });

  const powerEvents = [] as V2Pdu[];

  for (const event of fullConflictedSet) {
    if (isPowerEvent(event)) {
      powerEvents.push(event);
    }
  }

  // enlarge X by adding the events in the auth chain of P which also belong to the full conflicted set
  for (const event of powerEvents) {
    const authChain = await getAuthChain(event, { store, remote });
    for (const authEvent of authChain) {
      if (fullConflictedSet.has(authEvent)) {
        powerEvents.push(authEvent);
      }
    }
  }

  // Sort X into a list using the reverse topological power ordering.
  const sortedPowerEvents = await reverseTopologicalPowerSort(
    new Set(powerEvents),
    { store, remote }
  );

  // Apply the iterative auth checks algorithm, starting from the unconflicted state map, to the list of events from the previous step to get a partially resolved state.
  const [unconflicted] = await partitionState(state);

  // TODO: implement iterative auth checks algorithm
}

export async function mainlineOrdering(
  events: V2Pdu[], // TODO: or take event ids
  // Let P = P0 be an m.room.power_levels event
  powerLevelEvent: V2Pdu, // of which we will calculate the mainline
  {
    store,
    remote,
  }: {
    store: EventStore;
    remote: EventStoreRemote;
  }
): Promise<V2Pdu[]> {
  const getMainline = async (event: V2Pdu) => {
    const mainline = [] as V2Pdu[];

    const fn = async (event: V2Pdu) => {
      const authIds = event.auth_events;

      // Starting with i = 0, repeatedly fetch Pi+1, the m.room.power_levels event in the auth_events of Pi.
      for (const autheventid of authIds) {
        const event = await getEvent(autheventid, { store, remote });
        if (event?.type === PDUType.PowerLevels) {
          mainline.push(event);
          return fn(event);
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

  assert(mainline && mainline.length > 0, "mainline should not be empty");

  const mainlinePositions = new Map<EventID, number>(); // NOTE: see comment in the loop

  const mainlineMap = new Map<EventID, number>();

  for (let i = mainline.length - 1, j = 0; i >= 0; i--, j++) {
    mainlineMap.set(
      mainline[i].event_id /* the last event */,
      j /* the more we "walk" the grap the older we get to in the room state, so the older the event, the least depth it has */
    );
  }
  
  const getMainlinePositionOfEvent = async (event: V2Pdu): Promise<number> {
	  let _event = event;
	  
	  while (_event) {
		  // algorithm follows the same as mainline detection
		  if (mainlineMap.has(_event.event_id)) {
			  // if in map then this is already a powerLevel event
			  return mainlineMap.get(_event.event_id)!;
		  }
		  
		  for (const autheventid of _event.auth_events) {
			  const authEvent = await getEvent(autheventid, { store, remote });
			  
			  assert(authEvent, "auth event should not be null, either in our store or remote");
			  
			  // Find the smallest index j ≥ 1 for which e_j belongs to the mainline of P.
			  if (authEvent.type === PDUType.PowerLevels /* && mainlineMap.has(autheventid) */ /* the check for mainlineMap is already done on the next iteration */) {
				  // If such a j exists, then e_j = P_i for some unique index i ≥ 0.
				  // e_j is current event, _event, the one we are traversing
				  _event = authEvent;
				  break;
			  }
		  }
		}
		
		return 0;
  }

  // Let e = e0 be another event (possibly another m.room.power_levels event)
  // iterating over all, could have been better visualized with a for (let i = 0; i < events.length; i++) loop
  for (const event of events) {
    // "Now compare these two lists as follows."
    // since we have to compare it doesn't make sense to fetch mainlines of all events here, too expensive, let's try to calculate on the fly
    // we just want the mainline position of the event

	mainlinePositions.set(event.event_id, await getMainlinePositionOfEvent(event));
  }

  // the mainline ordering based on P of a set of events is the ordering
  // from smallest to largest
//   using the following comparison relation on events: for events x and y, x < y if
  const comparisonFn = (e1: V2Pdu, e2: V2Pdu) => {
    // the mainline position of x is greater than the mainline position of y
	if (mainlinePositions.get(e1.event_id)! > mainlinePositions.get(e2.event_id)!) {
	  return -1;
	}

    // x’s origin_server_ts is less than y’s origin_server_ts
    if (e1.origin_server_ts < e2.origin_server_ts) {
      return -1;
    }

    // x’s event_id is less than y’s event_id.
    if (e1.event_id < e2.event_id) {
      return -1;
    }

    return 1;
  };
  
  return events.sort(comparisonFn);
}
