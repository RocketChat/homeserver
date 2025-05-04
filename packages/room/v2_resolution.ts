// https://spec.matrix.org/v1.12/rooms/v2/#state-resolution

import { PDUType, type PDUMembershipEvent, type V2Pdu } from "./events";

export async function resolveStateV2(events: V2Pdu[]) {
  // spec uses term "set of room states"
  // this map is synonymous to "set of room states"
  // non-duplication like a set is guaranteed by the map key
  // each key is a property of the room's state
  const state: State = new Map();

  for (const event of events) {
    const mapKey = getStateMapKey(event);
    // if (state.has(mapKey)) {
    //   // If the event is already in the state, skip it
    //   continue;
    // }

    // The room state S′(E) after an event E is defined in terms of the room state S(E) before E, and depends on whether E is a state event or a message event:
    if (event.type === PDUType.Message) {
      // If E is a message event, then S′(E) = S(E).
      state.set(mapKey, event.event_id);
      continue;
    }

    // If E is a state event, then S′(E) is S(E), except that its entry corresponding to the event_type and state_key of E is replaced by the event_id of E.
    // state.set(mapKey, event.event_id); this would have been like this if no conflicts where guranteed
    if (state.has(mapKey)) {
      /// conflict
    }

    (() => {})();
  }
}
