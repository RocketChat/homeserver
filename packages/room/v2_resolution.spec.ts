import { PriorityQueue } from "@datastructures-js/priority-queue";
import { type V2Pdu, PDUType } from "./events";
import {
	_kahnsOrder,
	lexicographicalTopologicalSort,
	type EventStore,
	type EventStoreRemote,
	type Queue,
} from "./state_resolution/definitions/definitions";

import { resolveStateV2Plus } from "./v2_resolution";

import { it, describe, expect } from "bun:test";

class MockEventStore implements EventStore {
	public events: Array<V2Pdu> = [];
	async getEvents(eventIds: string[]): Promise<V2Pdu[]> {
		return this.events.filter((e) => eventIds.includes(e.event_id));
	}

	toMap(): Map<string, V2Pdu> {
		return new Map(this.events.map((e) => [e.event_id, e]));
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

/*
 * ALICE = "@alice:example.com"
BOB = "@bob:example.com"
CHARLIE = "@charlie:example.com"
EVELYN = "@evelyn:example.com"
ZARA = "@zara:example.com"

ROOM_ID = "!test:example.com"

MEMBERSHIP_CONTENT_JOIN = {"membership": Membership.JOIN}
MEMBERSHIP_CONTENT_BAN = {"membership": Membership.BAN}


ORIGIN_SERVER_TS = 0


class FakeClock:
    def sleep(self, msec: float) -> "tefer.Deferred[None]":
        return defer.succeed(None)


class FakeEvent:
    """A fake event we use as a convenience.

    NOTE: Again as a convenience we use "node_ids" rather than event_ids to
    refer to events. The event_id has node_id as localpart and example.com
    as domain.
    """

    def __init__(
        self,
        id: str,
        sender: str,
        type: str,
        state_key: Optional[str],
        content: Mapping[str, object],
    ):
        self.node_id = id
        self.event_id = EventID(id, "example.com").to_string()
        self.sender = sender
        self.type = type
        self.state_key = state_key
        self.content = content
        self.room_id = ROOM_ID

    def to_event(self, auth_events: List[str], prev_events: List[str]) -> EventBase:
        """Given the auth_events and prev_events, convert to a Frozen Event

        Args:
            auth_events: list of event_ids
            prev_events: list of event_ids

        Returns:
            FrozenEvent
        """
        global ORIGIN_SERVER_TS

        ts = ORIGIN_SERVER_TS
        ORIGIN_SERVER_TS = ORIGIN_SERVER_TS + 1

        event_dict = {
            "auth_events": [(a, {}) for a in auth_events],
            "prev_events": [(p, {}) for p in prev_events],
            "event_id": self.event_id,
            "sender": self.sender,
            "type": self.type,
            "content": self.content,
            "origin_server_ts": ts,
            "room_id": ROOM_ID,
        }

        if self.state_key is not None:
            event_dict["state_key"] = self.state_key

        return make_event_from_dict(event_dict)


# All graphs start with this set of events
INITIAL_EVENTS = [
    FakeEvent(
        id="CREATE",
        sender=ALICE,
        type=EventTypes.Create,
        state_key="",
        content={"creator": ALICE},
    ),
    FakeEvent(
        id="IMA",
        sender=ALICE,
        type=EventTypes.Member,
        state_key=ALICE,
        content=MEMBERSHIP_CONTENT_JOIN,
    ),
    FakeEvent(
        id="IPOWER",
        sender=ALICE,
        type=EventTypes.PowerLevels,
        state_key="",
        content={"users": {ALICE: 100}},
    ),
    FakeEvent(
        id="IJR",
        sender=ALICE,
        type=EventTypes.JoinRules,
        state_key="",
        content={"join_rule": JoinRules.PUBLIC},
    ),
    FakeEvent(
        id="IMB",
        sender=BOB,
        type=EventTypes.Member,
        state_key=BOB,
        content=MEMBERSHIP_CONTENT_JOIN,
    ),
    FakeEvent(
        id="IMC",
        sender=CHARLIE,
        type=EventTypes.Member,
        state_key=CHARLIE,
        content=MEMBERSHIP_CONTENT_JOIN,
    ),
    FakeEvent(
        id="IMZ",
        sender=ZARA,
        type=EventTypes.Member,
        state_key=ZARA,
        content=MEMBERSHIP_CONTENT_JOIN,
    ),
    FakeEvent(
        id="START", sender=ZARA, type=EventTypes.Message, state_key=None, content={}
    ),
    FakeEvent(
        id="END", sender=ZARA, type=EventTypes.Message, state_key=None, content={}
    ),
]

INITIAL_EDGES = ["START", "IMZ", "IMC", "IMB", "IJR", "IPOWER", "IMA", "CREATE"]
*/

// convert above comment to typescript and my code

const ALICE = "@alice:example.com";
const BOB = "@bob:example.com";
const CHARLIE = "@charlie:example.com";
const EVELYN = "@evelyn:example.com";
const ZARA = "@zara:example.com";

const ROOM_ID = "!test:example.com";

const MEMBERSHIP_CONTENT_JOIN = { membership: "join" };
const MEMBERSHIP_CONTENT_BAN = { membership: "ban" };

let ORIGIN_SERVER_TS = 0;

// igore clock

class FakeEvent {
	node_id: string;
	event_id: string;
	sender: string;
	type: string;
	state_key: string | null;
	content: Record<string, any>;
	room_id: string;
	constructor(
		id: string,
		sender: string,
		type: string,
		state_key: string | null,
		content: Record<string, any>,
	) {
		this.node_id = id;
		this.event_id = id;
		this.sender = sender;
		this.type = type;
		this.state_key = state_key;
		this.content = content;
		this.room_id = ROOM_ID;
	}

	toEvent(auth_events: string[], prev_events: string[]) {
		// tackle timestamp
		/*
		 *         event_dict = {
            "auth_events": [(a, {}) for a in auth_events],
            "prev_events": [(p, {}) for p in prev_events],
            "event_id": self.event_id,
            "sender": self.sender,
            "type": self.type,
            "content": self.content,
            "origin_server_ts": ts,
            "room_id": ROOM_ID,
        }

        if self.state_key is not None:
            event_dict["state_key"] = self.state_key

		*/
		const event_dict = {
			auth_events: auth_events.map((a) => [a, {}]),
			prev_events: prev_events.map((p) => [p, {}]),
			event_id: this.event_id,
			sender: this.sender,
			type: this.type,
			state_key: null,
			origin_server_ts: ORIGIN_SERVER_TS,
			content: this.content,
			room_id: this.room_id,
		} as any;

		ORIGIN_SERVER_TS = ORIGIN_SERVER_TS + 1;

		if (this.state_key !== null) {
			event_dict.state_key = this.state_key;
		}

		return event_dict;
	}
}

const INITIAL_EVENTS = [
	new FakeEvent("CREATE", ALICE, PDUType.Create, "", { creator: ALICE }),
	new FakeEvent("IMA", ALICE, PDUType.Member, ALICE, MEMBERSHIP_CONTENT_JOIN),
	new FakeEvent("IPOWER", ALICE, PDUType.PowerLevels, "", {
		users: { ALICE: 100 },
	}),
	new FakeEvent("IJR", ALICE, PDUType.JoinRules, "", { join_rule: "public" }),
	new FakeEvent("IMB", BOB, PDUType.Member, BOB, MEMBERSHIP_CONTENT_JOIN),
	new FakeEvent(
		"IMC",
		CHARLIE,
		PDUType.Member,
		CHARLIE,
		MEMBERSHIP_CONTENT_JOIN,
	),
	new FakeEvent("IMZ", ZARA, PDUType.Member, ZARA, MEMBERSHIP_CONTENT_JOIN),
	new FakeEvent("START", ZARA, PDUType.Message, null, {}),
	new FakeEvent("END", ZARA, PDUType.Message, null, {}),
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
	it("mainline sort", async () => {
		/*
		def test_mainline_sort(self) -> None:
        """Tests that the mainline ordering works correctly."""

        events = [
            FakeEvent(
                id="T1", sender=ALICE, type=EventTypes.Topic, state_key="", content={}
            ),
            FakeEvent(
                id="PA1",
                sender=ALICE,
                type=EventTypes.PowerLevels,
                state_key="",
                content={"users": {ALICE: 100, BOB: 50}},
            ),
            FakeEvent(
                id="T2", sender=ALICE, type=EventTypes.Topic, state_key="", content={}
            ),
            FakeEvent(
                id="PA2",
                sender=ALICE,
                type=EventTypes.PowerLevels,
                state_key="",
                content={
                    "users": {ALICE: 100, BOB: 50},
                    "events": {EventTypes.PowerLevels: 100},
                },
            ),
            FakeEvent(
                id="PB",
                sender=BOB,
                type=EventTypes.PowerLevels,
                state_key="",
                content={"users": {ALICE: 100, BOB: 50}},
            ),
            FakeEvent(
                id="T3", sender=BOB, type=EventTypes.Topic, state_key="", content={}
            ),
            FakeEvent(
                id="T4", sender=ALICE, type=EventTypes.Topic, state_key="", content={}
            ),
        ]

        edges = [
            ["END", "T3", "PA2", "T2", "PA1", "T1", "START"],
            ["END", "T4", "PB", "PA1"],
        ]
		*/
		const events = [
			new FakeEvent("T1", ALICE, PDUType.Topic, "", {}),
			new FakeEvent("PA1", ALICE, PDUType.PowerLevels, "", {
				users: { ALICE: 100, BOB: 50 },
			}),
			new FakeEvent("T2", ALICE, PDUType.Topic, "", {}),
			new FakeEvent("PA2", ALICE, PDUType.PowerLevels, "", {
				users: { ALICE: 100, BOB: 50 },
				events: { [PDUType.PowerLevels]: 100 },
			}),
			new FakeEvent("PB", BOB, PDUType.PowerLevels, "", {
				users: { ALICE: 100, BOB: 50 },
			}),
			new FakeEvent("T3", BOB, PDUType.Topic, "", {}),
			new FakeEvent("T4", ALICE, PDUType.Topic, "", {}),
		];

		const edges = [
			["END", "T3", "PA2", "T2", "PA1", "T1", "START"],
			["END", "T4", "PB", "PA1"],
		];

		const graph = new Map<string, Set<string>>();

		const reverseGraph = new Map<string, Set<string>>();

		for (const node of INITIAL_EVENTS) {
			graph.set(node.event_id, new Set());
			reverseGraph.set(node.event_id, new Set());
		}

		for (const node of events) {
			graph.set(node.event_id, new Set());
			reverseGraph.set(node.event_id, new Set());
		}

		const fakeEventMap = new Map<string, FakeEvent>();

		for (const node of INITIAL_EVENTS) {
			fakeEventMap.set(node.event_id, node);
		}
		for (const node of events) {
			fakeEventMap.set(node.event_id, node);
		}

		// because I am porting the tests :/
		const pairwise = function* <T>(arr: T[]) {
			for (let i = 0; i < arr.length - 1; i += 1) {
				yield [arr[i], arr[i + 1]];
			}
		};

		for (const [a, b] of pairwise(INITIAL_EDGES)) {
			if (a && b) {
				graph.get(b)?.add(a);
				reverseGraph.get(a)?.add(b);
			}
		}

		for (const edge of edges) {
			for (const [a, b] of pairwise(edge)) {
				if (a && b) {
					graph.get(b)?.add(a);
					reverseGraph.get(a)?.add(b);
				}
			}
		}

		console.log("Graph:", graph);

		// @ts-ignore
		eventStore.events = [...INITIAL_EVENTS, ...events];

		// @ts-ignore
		const sorted = _kahnsOrder(
			graph,
			(a, b) => a.localeCompare(b),
			PriorityQueue,
		);

		const expectationSort = [
			"CREATE",
			"IMA",
			"IPOWER",
			"IJR",
			"IMB",
			"IMC",
			"IMZ",
			"START",
			"T1",
			"PA1",
			"PB",
			"T2",
			"PA2",
			"T3",
			"T4",
			"END",
		];

		expect(sorted).toEqual(expectationSort);

		/*
		*prev_events IMA ['CREATE']
prev_events IPOWER ['IMA']
prev_events IJR ['IPOWER']
prev_events IMB ['IJR']
prev_events IMC ['IMB']
prev_events IMZ ['IMC']
prev_events START ['IMZ']
prev_events T1 ['START']
prev_events PA1 ['T1']
prev_events PB ['PA1']
prev_events T2 ['PA1']
prev_events PA2 ['T2']
prev_events T3 ['PA2']
prev_events T4 ['PB']
prev_events END ['T3', 'T4']*/
		const expectedPrevEvents = new Map<string, string[]>([
			["IMA", ["CREATE"]],
			["IPOWER", ["IMA"]],
			["IJR", ["IPOWER"]],
			["IMB", ["IJR"]],
			["IMC", ["IMB"]],
			["IMZ", ["IMC"]],
			["START", ["IMZ"]],
			["T1", ["START"]],
			["PA1", ["T1"]],
			["PB", ["PA1"]],
			["T2", ["PA1"]],
			["PA2", ["T2"]],
			["T3", ["PA2"]],
			["T4", ["PB"]],
			["END", ["T3", "T4"]],
		]);

		for (const nodeId of sorted) {
			const fakeEvent = fakeEventMap.get(nodeId)!;

			const prevEvents = reverseGraph.get(nodeId)!;
			expect([...prevEvents]).toEqual(expectedPrevEvents.get(nodeId) ?? []);
		}
	});
});
