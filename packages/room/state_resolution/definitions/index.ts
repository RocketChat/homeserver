import {
  PDUType,
  type PDUMembershipEvent,
  type State,
  type StateMapKey,
  type V2Pdu,
} from "../../events";

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

interface EventStore {
  getEvents(eventId: string[]): Promise<V2Pdu[]>;
}

interface EventStoreRemote {
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

  return result;
}

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

  const authChains = [] as V2Pdu[][];

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

    authChains.push(authChain);
  }

  const flatAuthChain = authChains.flat(1);
  const flatAuthChainSet = new Set(flatAuthChain);

  if (flatAuthChain.length === flatAuthChainSet.size) {
    // return here
  }
}
