import { PriorityQueue } from "@datastructures-js/priority-queue";
import { type V2Pdu, PDUType } from "./events";
import {
	_kahnsOrder,
	getStateMapKey,
	getStateTypesForEventAuth,
	type EventStore,
	type EventStoreRemote,
	type Queue,
} from "./state_resolution/definitions/definitions";

import { resolveStateV2Plus, setlog } from "./v2_resolution";

import { it, describe, expect, afterEach } from "bun:test";

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

const ALICE = "@alice:example.com";
const BOB = "@bob:example.com";
const CHARLIE = "@charlie:example.com";
const EVELYN = "@evelyn:example.com";
const ZARA = "@zara:example.com";

const ROOM_ID = "!test:example.com";

const MEMBERSHIP_CONTENT_JOIN = { membership: "join" };
const MEMBERSHIP_CONTENT_BAN = { membership: "ban" };

let ORIGIN_SERVER_TS = 0;

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
		this.event_id = `${id}:example.com`;
		this.sender = sender;
		this.type = type;
		this.state_key = state_key;
		this.content = content;
		this.room_id = ROOM_ID;
	}

	toEvent(auth_events: string[], prev_events: string[]): V2Pdu {
		const event_dict = {
			auth_events: auth_events,
			prev_events: prev_events,
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

function getGraph(events: FakeEvent[], edges: string[][]) {
	const graph = new Map<string, Set<string>>();

	const reverseGraph = new Map<string, Set<string>>();

	const fakeEventMap = new Map<string, FakeEvent>();

	for (const node of INITIAL_EVENTS) {
		graph.set(node.node_id, new Set());
		reverseGraph.set(node.node_id, new Set());
		fakeEventMap.set(node.node_id, node);
	}

	for (const node of events) {
		graph.set(node.node_id, new Set());
		reverseGraph.set(node.node_id, new Set());
		fakeEventMap.set(node.node_id, node);
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

	return { graph, reverseGraph, fakeEventMap };
}

async function runTest(events: FakeEvent[], edges: string[][]) {
	const { graph, reverseGraph, fakeEventMap } = getGraph(events, edges);

	const sorted = _kahnsOrder({
		indegreeGraph: reverseGraph,
		compareFunc: (a, b) => a.localeCompare(b),
		queueClass: PriorityQueue,
	});

	type StateKey = `${PDUType}:${string}`;

	const stateAtEventId = new Map<string, Map<StateKey, V2Pdu>>();

	const [create, ...rest] = sorted;

	// the first one should be prevEvents.length === 0
	expect(create).toEqual("CREATE");

	const createEvent = fakeEventMap.get(create)!.toEvent([], []);

	eventStore.events.push(createEvent);

	stateAtEventId.set(
		createEvent.event_id,
		new Map([
			[getStateMapKey(createEvent) as unknown as StateKey, createEvent],
		]),
	);

	for (const nodeId of rest) {
		const prevEventsNodeIds = reverseGraph.get(nodeId)!;

		let stateBefore: Map<string, V2Pdu>;

		if (prevEventsNodeIds.size === 1) {
			// very next to CREATE
			stateBefore = stateAtEventId.get(
				fakeEventMap.get(prevEventsNodeIds.values().next().value!)!.event_id,
			)!;
		} else {
			// get all the events from the last state
			const eventsToResolve = prevEventsNodeIds
				.values()
				.map((nodeId) => {
					const { event_id } = fakeEventMap.get(nodeId)!;
					return stateAtEventId.get(event_id)!;
				})
				.flatMap((state) => state.values())
				.toArray();

			stateBefore = await resolveStateV2Plus(eventsToResolve, {
				store: eventStore,
				remote: eventStoreRemote,
			});
		}

		// whatever was state before, append current event info to new state
		const stateAfter = structuredClone(stateBefore);

		/// get the authEvents for the current event
		const authEvents = [];
		const authTypes = getStateTypesForEventAuth(
			fakeEventMap.get(nodeId)!.toEvent([], []),
		);
		for (const type of authTypes) {
			// get the auth event id from the seen state
			const authEvent = stateBefore.get(type);
			if (authEvent) {
				authEvents.push(authEvent.event_id);
			}
		}
		const event = fakeEventMap.get(nodeId)!.toEvent(
			authEvents,
			prevEventsNodeIds
				.values()
				.map((nodeId) => fakeEventMap.get(nodeId)!.event_id)
				.toArray(),
		);

		eventStore.events.push(event);

		stateAfter.set(getStateMapKey(event), event);

		stateAtEventId.set(event.event_id, stateAfter as any);
	}

	return stateAtEventId.get("END:example.com");
}

setlog(false);

describe("Definitions", () => {
	afterEach(() => {
		eventStore.events = [];
	});

	it("ban vs pl", async () => {
		/*
		 *         events = [
            FakeEvent(
                id="PA",
                sender=ALICE,
                type=EventTypes.PowerLevels,
                state_key="",
                content={"users": {ALICE: 100, BOB: 50}},
            ),
            FakeEvent(
                id="MA",
                sender=ALICE,
                type=EventTypes.Member,
                state_key=ALICE,
                content={"membership": Membership.JOIN},
            ),
            FakeEvent(
                id="MB",
                sender=ALICE,
                type=EventTypes.Member,
                state_key=BOB,
                content={"membership": Membership.BAN},
            ),
            FakeEvent(
                id="PB",
                sender=BOB,
                type=EventTypes.PowerLevels,
                state_key="",
                content={"users": {ALICE: 100, BOB: 50}},
            ),
        ]

        edges = [["END", "MB", "MA", "PA", "START"], ["END", "PB", "PA"]]

        expected_state_ids = ["PA", "MA", "MB"]

		*/
		const events = [
			new FakeEvent("PA", ALICE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent(
				"MA",
				ALICE,
				PDUType.Member,
				ALICE,
				MEMBERSHIP_CONTENT_JOIN,
			),
			new FakeEvent("MB", ALICE, PDUType.Member, BOB, MEMBERSHIP_CONTENT_BAN),
			new FakeEvent("PB", BOB, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
		];

		const edges = [
			["END", "MB", "MA", "PA", "START"],
			["END", "PB", "PA"],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get("m.room.power_levels:")).toHaveProperty(
			"event_id",
			"PA:example.com",
		);
		expect(finalState?.get("m.room.member:@bob:example.com")).toHaveProperty(
			"event_id",
			"MB:example.com",
		);
		expect(finalState?.get("m.room.member:@alice:example.com")).toHaveProperty(
			"event_id",
			"MA:example.com",
		);
	});

	it("join rule evasion", async () => {
		const events = [
			new FakeEvent("JR", ALICE, PDUType.JoinRules, "", {
				join_rules: "private",
			}),
			new FakeEvent("ME", EVELYN, PDUType.Member, EVELYN, {
				membership: "join",
			}),
		];

		const edges = [
			["END", "JR", "START"],
			["END", "ME", "START"],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get("m.room.join_rules:")).toHaveProperty(
			"event_id",
			"JR:example.com",
		);
	});
	it("offtopic pl", async () => {
		// FIXME:
		const events = [
			new FakeEvent("PA", ALICE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent("PB", BOB, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50, [CHARLIE]: 50 },
			}),
			new FakeEvent("PC", CHARLIE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50, [CHARLIE]: 0 },
			}),
		];

		const edges = [
			["END", "PC", "PB", "PA", "START"],
			["END", "PA"],
		];

		const { graph, reverseGraph, fakeEventMap } = getGraph(events, edges);

		console.log({ reverseGraph });

		const finalState = await runTest(events, edges);

		expect(finalState?.get("m.room.power_levels:")).toHaveProperty(
			"event_id",
			"PC:example.com",
		);
	});
	it("topic basic", async () => {
		const events = [
			new FakeEvent("T1", ALICE, PDUType.Topic, "", {}),
			new FakeEvent("PA1", ALICE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent("T2", ALICE, PDUType.Topic, "", {}),
			new FakeEvent("PA2", ALICE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 0 },
			}),
			new FakeEvent("PB", BOB, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent("T3", BOB, PDUType.Topic, "", {}),
		];

		const edges = [
			["END", "PA2", "T2", "PA1", "T1", "START"],
			["END", "T3", "PB", "PA1"],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get("m.room.topic:")).toHaveProperty(
			"event_id",
			"T2:example.com",
		);
		expect(finalState?.get("m.room.power_levels:")).toHaveProperty(
			"event_id",
			"PA2:example.com",
		);
	});
	it("topic reset", async () => {
		const events = [
			new FakeEvent("T1", ALICE, PDUType.Topic, "", {}),
			new FakeEvent("PA", ALICE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent("T2", BOB, PDUType.Topic, "", {}),
			new FakeEvent("MB", ALICE, PDUType.Member, BOB, MEMBERSHIP_CONTENT_BAN),
		];

		const edges = [
			["END", "MB", "T2", "PA", "T1", "START"],
			["END", "T1"],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get("m.room.topic:")).toHaveProperty(
			"event_id",
			"T1:example.com",
		);
		expect(finalState?.get("m.room.member:@bob:example.com")).toHaveProperty(
			"event_id",
			"MB:example.com",
		);
		expect(finalState?.get("m.room.power_levels:")).toHaveProperty(
			"event_id",
			"PA:example.com",
		);
	});

	it("topic", async () => {
		const events = [
			new FakeEvent("T1", ALICE, PDUType.Topic, "", {}),
			new FakeEvent("PA1", ALICE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent("T2", ALICE, PDUType.Topic, "", {}),
			new FakeEvent("PA2", ALICE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 0 },
			}),
			new FakeEvent("PB", BOB, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent("T3", BOB, PDUType.Topic, "", {}),
			new FakeEvent("MZ1", ZARA, PDUType.Message, null, {}),
			new FakeEvent("T4", ALICE, PDUType.Topic, "", {}),
		];

		const edges = [
			["END", "T3", "PA2", "T2", "PA1", "T1", "START"],
			["END", "T4", "PB", "PA1"],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get("m.room.topic:")).toHaveProperty(
			"event_id",
			"T4:example.com",
		);
		expect(finalState?.get("m.room.power_levels:")).toHaveProperty(
			"event_id",
			"PA2:example.com",
		);
	});

	it("mainline sort", async () => {
		const events = [
			new FakeEvent("T1", ALICE, PDUType.Topic, "", {}),
			new FakeEvent("PA1", ALICE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent("T2", ALICE, PDUType.Topic, "", {}),
			new FakeEvent("PA2", ALICE, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
				events: { [PDUType.PowerLevels]: 100 },
			}),
			new FakeEvent("PB", BOB, PDUType.PowerLevels, "", {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent("T3", BOB, PDUType.Topic, "", {}),
			new FakeEvent("T4", ALICE, PDUType.Topic, "", {}),
		];

		const edges = [
			["END", "T3", "PA2", "T2", "PA1", "T1", "START"],
			["END", "T4", "PB", "PA1"],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get("m.room.topic:")).toHaveProperty(
			"event_id",
			"T3:example.com",
		);

		expect(finalState?.get("m.room.power_levels:")).toHaveProperty(
			"event_id",
			"PA2:example.com",
		);
	});
});
