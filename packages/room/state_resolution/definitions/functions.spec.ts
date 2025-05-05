import { describe, it, expect } from "bun:test";
import type { V2Pdu } from "../../events";
import {
  _kahnsOrder,
  reverseTopologicalPowerSort,
  type EventStore,
  type EventStoreRemote,
} from "./definitions";

class MockEventStore implements EventStore {
  public events: Array<V2Pdu> = [];
  async getEvents(eventIds: string[]): Promise<V2Pdu[]> {
    return this.events.filter((e) => eventIds.includes(e.event_id));
  }
}

class MockEventStoreRemote implements EventStoreRemote {
  async getEvent(eventId: string): Promise<V2Pdu | null> {
    return null;
  }
}

const eventStore = new MockEventStore();
const eventStoreRemote = new MockEventStoreRemote();

describe("Definitions", () => {
  it("should print right graph", async () => {
    eventStore.events = [
      {
        event_id: "event1",
        sender: "user1",
        type: "m.room.message",
        content: { body: "Hello" },
        depth: 1,
        hashes: { sha256: "hash1" },
        origin_server_ts: 123456789,
        prev_events: [],
        room_id: "room1",
        auth_events: [],
        signatures: {},
      },
      {
        event_id: "event2",
        sender: "user2",
        type: "m.room.message",
        content: { body: "Hi" },
        depth: 2,
        hashes: { sha256: "hash2" },
        origin_server_ts: 123456790,
        prev_events: ["event1"],
        room_id: "room1",
        auth_events: ["event1"],
        signatures: {},
      },
      {
        event_id: "event3",
        sender: "user3",
        type: "m.room.message",
        content: { body: "Hey" },
        depth: 3,
        hashes: { sha256: "hash3" },
        origin_server_ts: 123456791,
        prev_events: ["event2"],
        room_id: "room1",
        auth_events: ["event2"],
        signatures: {},
      },
      {
        event_id: "event4",
        sender: "user4",
        type: "m.room.message",
        content: { body: "Howdy" },
        depth: 4,
        hashes: { sha256: "hash4" },
        origin_server_ts: 123456792,
        prev_events: ["event3"],
        room_id: "room1",
        auth_events: ["event3", "event2", "event1"],
        signatures: {},
      },
    ];

    reverseTopologicalPowerSort(new Set(eventStore.events), {
      store: eventStore,
      remote: eventStoreRemote,
    });
  });
  it("should print the right kahns result", () => {
    const inputs = [
      [
        [2, 3],
        [3, 1],
        [4, 0],
        [4, 1],
        [5, 0],
        [5, 2],
      ],
      [
        [0, 1],
        [1, 2],
        [3, 2],
        [3, 4],
      ],
    ];

    const expected = [
      [4, 5, 0, 2, 3, 1],
      [0, 3, 1, 4, 2],
    ];
    for (let i = 0; i < inputs.length; i++) {
      expect(_kahnsOrder(inputs[i], (a, b) => a - b)).toEqual(expected[i]);
    }
  });
});
