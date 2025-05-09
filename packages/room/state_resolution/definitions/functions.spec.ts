import { describe, it, expect } from "bun:test";
import { PDUType, type V2Pdu } from "../../events";
import {
  _kahnsOrder,
  lexicographicalTopologicalSort,
  resolveStateV2Plus,
  reverseTopologicalPowerSort,
  type EventStore,
  type EventStoreRemote,
  type Queue,
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

function createEvent(pdu: Partial<V2Pdu>) {
  // TODO:
}

const eventStore = new MockEventStore();
const eventStoreRemote = new MockEventStoreRemote();

class MockQueue implements Queue<number> {
  items: number[] = [];

  constructor(_compare: any) {
    // noop
  }
  enqueue(item: number): Queue<number> {
    this.items.push(item);
    return this;
  }
  push(item: number): Queue<number> {
    this.items.push(item);
    return this;
  }
  pop(): number | null {
    if (this.items.length === 0) {
      return null;
    }
    return this.items.shift()!;
  }
  isEmpty(): boolean {
    return this.items.length === 0;
  }
}

const INITIAL_EVENTS = [
  {
    event_id: "CREATE",
    sender: "ALICE",
    type: PDUType.Create,
    state_key: "",
    content: { creator: "ALICE" },
    origin_server_ts: 0,
  },
  {
    event_id: "IMA",
    sender: "ALICE",
    type: PDUType.Member,
    state_key: "ALICE",
    content: {
      membership: "join",
      join_authorised_via_users_server: "",
      reason: "",
    },
    origin_server_ts: 1,
  },
  {
    event_id: "IMB",
    sender: "ALICE",
    origin_server_ts: 2,
    type: PDUType.Member,
    state_key: "BOB",
    content: {
      membership: "join",
      join_authorised_via_users_server: "",
      reason: "",
    },
  },
  {
    event_id: "IPOWER",
    sender: "ALICE",
    origin_server_ts: 3,
    type: PDUType.PowerLevels,
    state_key: "",
    content: { users: { ALICE: 100 } },
  },
  {
    event_id: "IJR",
    sender: "ALICE",
    origin_server_ts: 4,
    type: PDUType.JoinRules,
    state_key: "",
    content: { join_rule: "public" },
  },
  {
    event_id: "IMB",
    sender: "BOB",
    type: PDUType.Member,
    state_key: "BOB",
    origin_server_ts: 5,
    content: {
      membership: "join",
      join_authorised_via_users_server: "",
      reason: "",
    },
  },
  {
    event_id: "IMC",
    sender: "CHARLIE",
    type: PDUType.Member,
    state_key: "CHARLIE",
    origin_server_ts: 6,
    content: {
      membership: "join",
      join_authorised_via_users_server: "",
      reason: "",
    },
  },
  {
    event_id: "IMZ",
    sender: "ZARA",
    type: PDUType.Member,
    origin_server_ts: 7,
    state_key: "ZARA",
    content: {
      membership: "join",
      join_authorised_via_users_server: "",
      reason: "",
    },
  },
  {
    event_id: "START",
    sender: "ZARA",
    type: PDUType.Message,
    state_key: null,
    origin_server_ts: 8,
    content: {},
  },
  {
    event_id: "END",
    sender: "ZARA",
    type: PDUType.Message,
    origin_server_ts: 9,
    state_key: null,
    content: {},
  },
];

const INITIAL_EDGES = [
  "START",
  "IMZ",
  "IMC",
  "IMB",
  "IJR",
  "IPOWER",
  "IMA",
  "CREATE",
];

describe("Definitions", () => {
  //   it("should print right graph", async () => {
  //     eventStore.events = [
  //       {
  //         event_id: "event1",
  //         sender: "user1",
  //         type: "m.room.message",
  //         content: { body: "Hello" },
  //         depth: 1,
  //         hashes: { sha256: "hash1" },
  //         origin_server_ts: 123456789,
  //         prev_events: [],
  //         room_id: "room1",
  //         auth_events: [],
  //         signatures: {},
  //       },
  //       {
  //         event_id: "event2",
  //         sender: "user2",
  //         type: "m.room.message",
  //         content: { body: "Hi" },
  //         depth: 2,
  //         hashes: { sha256: "hash2" },
  //         origin_server_ts: 123456790,
  //         prev_events: ["event1"],
  //         room_id: "room1",
  //         auth_events: ["event1"],
  //         signatures: {},
  //       },
  //       {
  //         event_id: "event3",
  //         sender: "user3",
  //         type: "m.room.message",
  //         content: { body: "Hey" },
  //         depth: 3,
  //         hashes: { sha256: "hash3" },
  //         origin_server_ts: 123456791,
  //         prev_events: ["event2"],
  //         room_id: "room1",
  //         auth_events: ["event2"],
  //         signatures: {},
  //       },
  //       {
  //         event_id: "event4",
  //         sender: "user4",
  //         type: "m.room.message",
  //         content: { body: "Howdy" },
  //         depth: 4,
  //         hashes: { sha256: "hash4" },
  //         origin_server_ts: 123456792,
  //         prev_events: ["event3"],
  //         room_id: "room1",
  //         auth_events: ["event3", "event2", "event1"],
  //         signatures: {},
  //       },
  //     ];

  //     reverseTopologicalPowerSort(new Set(eventStore.events), {
  //       store: eventStore,
  //       remote: eventStoreRemote,
  //     });
  //   });
  //   it("should print the right kahns result", () => {
  //     const inputs = [
  //       [
  //         [2, 3],
  //         [3, 1],
  //         [4, 0],
  //         [4, 1],
  //         [5, 0],
  //         [5, 2],
  //       ],
  //       [
  //         [0, 1],
  //         [1, 2],
  //         [3, 2],
  //         [3, 4],
  //       ],
  //     ];

  //     const expected = [
  //       [4, 5, 0, 2, 3, 1],
  //       [0, 3, 1, 4, 2],
  //     ];
  //     for (let i = 0; i < inputs.length; i++) {
  //       expect(_kahnsOrder(inputs[i], (a, b) => a - b, MockQueue)).toEqual(
  //         expected[i]
  //       );
  //     }
  //   });

  it("mainline sort", async () => {
    const events = [
      {
        event_id: "T1",
        sender: "ALICE",
        type: "m.room.topic",
        origin_server_ts: 10,
        state_key: "",
        content: {},
      },
      {
        event_id: "PA1",
        sender: "ALICE",
        type: "m.room.power_levels",
        origin_server_ts: 11,
        state_key: "",
        content: { users: { ALICE: 100, BOB: 50 } },
      },
      {
        event_id: "T2",
        sender: "ALICE",
        origin_server_ts: 12,
        type: "m.room.topic",
        state_key: "",
        content: {},
      },
      {
        event_id: "PA2",
        origin_server_ts: 13,
        sender: "ALICE",
        type: "m.room.power_levels",
        state_key: "",
        content: {
          users: { ALICE: 100, BOB: 50 },
          events: { [PDUType.PowerLevels]: 100 },
        },
      },
      {
        event_id: "PB",
        sender: "BOB",
        type: "m.room.power_levels",
        origin_server_ts: 14,
        state_key: "",
        content: { users: { ALICE: 100, BOB: 50 } },
      },
      {
        event_id: "T3",
        origin_server_ts: 16,
        sender: "BOB",
        type: "m.room.topic",
        state_key: "",
        content: {},
      },
      {
        event_id: "T4",
        sender: "ALICE",
        origin_server_ts: 15,
        type: "m.room.topic",
        state_key: "",
        content: {},
      },
      //   {
      //     event_id: "T5",
      //     sender: "ALICE",
      //     type: "m.room.member",
      //     state_key: "BOB",
      //     content: {
      //       membership: "ban",
      //     },
      //   },
      //   {
      //     event_id: "T5",
      //     sender: "BOB",
      //     type: "m.room.member",
      //     state_key: "BOB",
      //     content: {
      //       membership: "join",
      //     },
      //   },
    ];

    const edges = [
      ["END", "T3", "PA2", "T2", "PA1", "T1", "START"],
      ["END", "T4", "PB", "PA1"],
    ];

    const graph = new Map<string, Set<string>>();

    for (const node of INITIAL_EVENTS) {
      graph.set(node.event_id, new Set());
    }

    for (const node of events) {
      graph.set(node.event_id, new Set());
    }

    for (let i = 0; i < INITIAL_EDGES.length; i += 2) {
      graph.get(INITIAL_EDGES[i])?.add(INITIAL_EDGES[i + 1]);
    }

    for (const edge of edges) {
      for (let i = 0; i < edge.length; i += 2) {
        graph.get(edge[i])?.add(edge[i + 1]);
      }
    }

    console.log("Graph:", graph);

    // @ts-ignore
    eventStore.events = [...INITIAL_EVENTS, ...events];

    const resolved = await resolveStateV2Plus(eventStore.events, {
      store: eventStore,
      remote: eventStoreRemote,
    });

    console.log("Resolved:", resolved);
  });
});
