import { type EventID, type StateMapKey } from '../../../types/_common';
import {} from '../../../types/v3-11';
import { type EventStore, _kahnsOrder, getAuthChainDifference, mainlineOrdering } from '../definitions';
import { resolveStateV2Plus } from './v2';

import { afterEach, describe, expect, it } from 'bun:test';

import type { PersistentEventBase } from '../../../manager/event-wrapper';
import { PersistentEventFactory } from '../../../manager/factory';

class MockEventStore implements EventStore {
	public events: Array<PersistentEventBase> = [];

	async getEvents(eventIds: string[]): Promise<PersistentEventBase[]> {
		return this.events.filter((e) => eventIds.includes(e.eventId));
	}

	async getEventsByHashes(hashes: string[]): Promise<PersistentEventBase[]> {
		const byHash = new Map<string, PersistentEventBase>();
		for (const event of this.events) {
			byHash.set(event.sha256hash, event);
		}
		return hashes.map((hash) => byHash.get(hash)!);
	}

	toMap(): Map<string, PersistentEventBase> {
		return new Map(this.events.map((e) => [e.eventId, e]));
	}
}

const eventStore = new MockEventStore();

const ALICE = '@alice:example.com';
const BOB = '@bob:example.com';
const CHARLIE = '@charlie:example.com';
const EVELYN = '@evelyn:example.com';
const ZARA = '@zara:example.com';

const ROOM_ID = '!test:example.com';

const MEMBERSHIP_CONTENT_JOIN = { membership: 'join' };
const MEMBERSHIP_CONTENT_BAN = { membership: 'ban' };

let ORIGIN_SERVER_TS = 0;

class FakeEvent {
	node_id: string;

	sender: string;

	type: string;

	state_key: string | null;

	content: Record<string, any>;

	room_id: string;

	event_dict: any;

	_event_id: EventID;

	constructor(id: string, sender: string, type: string, state_key: string | null, content: Record<string, any>) {
		this.node_id = id;
		this._event_id = `${id}:example.com`;
		this.sender = sender;
		this.type = type;
		this.state_key = state_key;
		this.content = content;
		this.room_id = ROOM_ID;
	}

	// event_dict should be filled by toEvent
	get event_id() {
		if (!this.event_dict) {
			throw new Error('event_dict is not set');
		}

		return PersistentEventFactory.createFromRawEvent(this.event_dict, '11').eventId;
	}

	toEvent(auth_events: string[], prev_events: string[]) {
		this.event_dict = {
			auth_events,
			prev_events,
			// event_id: this.event_id,
			sender: this.sender,
			type: this.type,
			state_key: null,
			origin_server_ts: ORIGIN_SERVER_TS,
			content: this.content,
			room_id: this.room_id,
		} as any;

		ORIGIN_SERVER_TS += 1;

		if (this.state_key !== null) {
			this.event_dict.state_key = this.state_key;
		}

		return PersistentEventFactory.createFromRawEvent(this.event_dict, '11');
	}
}

const INITIAL_EVENTS = [
	new FakeEvent('CREATE', ALICE, 'm.room.create', '', { creator: ALICE }),
	new FakeEvent('IMA', ALICE, 'm.room.member', ALICE, MEMBERSHIP_CONTENT_JOIN),
	new FakeEvent('IPOWER', ALICE, 'm.room.power_levels', '', {
		users: { ALICE: 100 },
	}),
	new FakeEvent('IJR', ALICE, 'm.room.join_rules', '', {
		join_rule: 'public',
	}),
	new FakeEvent('IMB', BOB, 'm.room.member', BOB, MEMBERSHIP_CONTENT_JOIN),
	new FakeEvent('IMC', CHARLIE, 'm.room.member', CHARLIE, MEMBERSHIP_CONTENT_JOIN),
	new FakeEvent('IMZ', ZARA, 'm.room.member', ZARA, MEMBERSHIP_CONTENT_JOIN),
	new FakeEvent('START', ZARA, 'm.room.message', null, {}),
	new FakeEvent('END', ZARA, 'm.room.message', null, {}),
];

const INITIAL_EDGES = ['START', 'IMZ', 'IMC', 'IMB', 'IJR', 'IPOWER', 'IMA', 'CREATE'];

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
	const { reverseGraph, fakeEventMap } = getGraph(events, edges);

	const sorted = _kahnsOrder({
		indegreeGraph: reverseGraph,
		compareFunc: (a, b) => a.localeCompare(b),
	});

	const stateAtEventId = new Map<string, Map<StateMapKey, PersistentEventBase<'11'>>>();

	const [create, ...rest] = sorted;

	// the first one should be prevEvents.length === 0
	expect(create).toEqual('CREATE');

	const createEvent = fakeEventMap.get(create)?.toEvent([], []);

	eventStore.events.push(createEvent);

	stateAtEventId.set(createEvent.eventId, new Map([[createEvent.getUniqueStateIdentifier(), createEvent]]));

	for (const nodeId of rest) {
		const prevEventsNodeIds = reverseGraph.get(nodeId)!;

		let stateBefore: Map<StateMapKey, PersistentEventBase>;

		if (prevEventsNodeIds.size === 1) {
			// very next to CREATE
			stateBefore = stateAtEventId.get(fakeEventMap.get(prevEventsNodeIds.values().next().value!)?.event_id)!;
		} else {
			stateBefore = await resolveStateV2Plus(
				prevEventsNodeIds
					.values()
					.map((nodeId) => stateAtEventId.get(fakeEventMap.get(nodeId)?.event_id)!)
					.toArray(),
				eventStore,
			);
		}

		// whatever was state before, append current event info to new state
		const stateAfter = new Map(stateBefore.entries());

		// / get the authEvents for the current event
		const authEvents = [];

		const authTypes = fakeEventMap.get(nodeId)?.toEvent([], []).getAuthEventStateKeys();

		for (const type of authTypes) {
			// get the auth event id from the seen state
			const authEvent = stateBefore.get(type);
			if (authEvent) {
				authEvents.push(authEvent.eventId);
			}
		}
		const event = fakeEventMap.get(nodeId)?.toEvent(
			authEvents,
			prevEventsNodeIds
				.values()
				.map((nodeId) => fakeEventMap.get(nodeId)?.event_id)
				.toArray(),
		);

		eventStore.events.push(event);

		stateAfter.set(event.getUniqueStateIdentifier(), event);

		stateAtEventId.set(event.eventId, stateAfter as any);
	}

	const eventIdToNodeIdMap = new Map();

	// only now can we make this fill, as we can gurantee the generated ids are the final ones
	for (const event of fakeEventMap.values()) {
		// NOTE(deb): these are not exactly node ids, but sort of a fake event id
		// tghis is to reduce the amount of diff generated when removing v1 and v2 code
		eventIdToNodeIdMap.set(event.event_id, event._event_id);
	}

	const stateAtEventIdCopy = new Map();

	// NOTE(deb): could change inplace, but doesn't help in debugging
	// it's just a test after all
	for (const [eventId, state] of stateAtEventId.entries()) {
		const nodeId = eventIdToNodeIdMap.get(eventId);
		if (!nodeId) {
			throw new Error('invalid eventId when trying to convert to nodeId');
		}

		const stateCopy = new Map();
		for (const [stateKey, stateEvent] of state.entries()) {
			const nodeId = eventIdToNodeIdMap.get(stateEvent.eventId);
			if (!nodeId) {
				throw new Error('invalid eventId when trying to convert to nodeId');
			}

			// NOTE(deb): to reduce diff elsewhere
			stateCopy.set(stateKey, { eventId: nodeId });
		}

		stateAtEventIdCopy.set(nodeId, stateCopy);
	}

	return stateAtEventIdCopy.get('END:example.com');
}

describe('Definitions', () => {
	afterEach(() => {
		eventStore.events = [];
	});

	it('01 ban vs pl', async () => {
		const events = [
			new FakeEvent('PA', ALICE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent('MA', ALICE, 'm.room.member', ALICE, MEMBERSHIP_CONTENT_JOIN),
			new FakeEvent('MB', ALICE, 'm.room.member', BOB, MEMBERSHIP_CONTENT_BAN),
			new FakeEvent('PB', BOB, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
		];

		const edges = [
			['END', 'MB', 'MA', 'PA', 'START'],
			['END', 'PB', 'PA'],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get('m.room.power_levels:')).toHaveProperty('eventId', 'PA:example.com');
		expect(finalState?.get('m.room.member:@bob:example.com')).toHaveProperty('eventId', 'MB:example.com');
		expect(finalState?.get('m.room.member:@alice:example.com')).toHaveProperty('eventId', 'MA:example.com');
	});

	it('02 join rule evasion', async () => {
		const events = [
			new FakeEvent('JR', ALICE, 'm.room.join_rules', '', {
				join_rules: 'private',
			}),
			new FakeEvent('ME', EVELYN, 'm.room.member', EVELYN, {
				membership: 'join',
			}),
		];

		const edges = [
			['END', 'JR', 'START'],
			['END', 'ME', 'START'],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get('m.room.join_rules:')).toHaveProperty('eventId', 'JR:example.com');
	});
	it('offtopic pl', async () => {
		// FIXME:
		const events = [
			new FakeEvent('PA', ALICE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent('PB', BOB, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50, [CHARLIE]: 50 },
			}),
			new FakeEvent('PC', CHARLIE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50, [CHARLIE]: 0 },
			}),
		];

		const edges = [
			['END', 'PC', 'PB', 'PA', 'START'],
			['END', 'PA'],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get('m.room.power_levels:')).toHaveProperty('eventId', 'PC:example.com');
	});
	it('topic basic', async () => {
		const events = [
			new FakeEvent('T1', ALICE, 'm.room.topic', '', {}),
			new FakeEvent('PA1', ALICE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent('T2', ALICE, 'm.room.topic', '', {}),
			new FakeEvent('PA2', ALICE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 0 },
			}),
			new FakeEvent('PB', BOB, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent('T3', BOB, 'm.room.topic', '', {}),
		];

		const edges = [
			['END', 'PA2', 'T2', 'PA1', 'T1', 'START'],
			['END', 'T3', 'PB', 'PA1'],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get('m.room.topic:')).toHaveProperty('eventId', 'T2:example.com');
		expect(finalState?.get('m.room.power_levels:')).toHaveProperty('eventId', 'PA2:example.com');
	});
	it('topic reset', async () => {
		const events = [
			new FakeEvent('T1', ALICE, 'm.room.topic', '', {}),
			new FakeEvent('PA', ALICE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent('T2', BOB, 'm.room.topic', '', {}),
			new FakeEvent('MB', ALICE, 'm.room.member', BOB, MEMBERSHIP_CONTENT_BAN),
		];

		const edges = [
			['END', 'MB', 'T2', 'PA', 'T1', 'START'],
			['END', 'T1'],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get('m.room.topic:')).toHaveProperty('eventId', 'T1:example.com');
		expect(finalState?.get('m.room.member:@bob:example.com')).toHaveProperty('eventId', 'MB:example.com');
		expect(finalState?.get('m.room.power_levels:')).toHaveProperty('eventId', 'PA:example.com');
	});

	it('topic', async () => {
		const events = [
			new FakeEvent('T1', ALICE, 'm.room.topic', '', {}),
			new FakeEvent('PA1', ALICE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent('T2', ALICE, 'm.room.topic', '', {}),
			new FakeEvent('PA2', ALICE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 0 },
			}),
			new FakeEvent('PB', BOB, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent('T3', BOB, 'm.room.topic', '', {}),
			new FakeEvent('MZ1', ZARA, 'm.room.message', null, {}),
			new FakeEvent('T4', ALICE, 'm.room.topic', '', {}),
		];

		const edges = [
			['END', 'T3', 'PA2', 'T2', 'PA1', 'T1', 'START'],
			['END', 'T4', 'PB', 'PA1'],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get('m.room.topic:')).toHaveProperty('eventId', 'T4:example.com');
		expect(finalState?.get('m.room.power_levels:')).toHaveProperty('eventId', 'PA2:example.com');
	});

	it('mainline sort', async () => {
		const events = [
			new FakeEvent('T1', ALICE, 'm.room.topic', '', {}),
			new FakeEvent('PA1', ALICE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent('T2', ALICE, 'm.room.topic', '', {}),
			new FakeEvent('PA2', ALICE, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
				events: { 'm.room.power_levels': 100 },
			}),
			new FakeEvent('PB', BOB, 'm.room.power_levels', '', {
				users: { [ALICE]: 100, [BOB]: 50 },
			}),
			new FakeEvent('T3', BOB, 'm.room.topic', '', {}),
			new FakeEvent('T4', ALICE, 'm.room.topic', '', {}),
		];

		const edges = [
			['END', 'T3', 'PA2', 'T2', 'PA1', 'T1', 'START'],
			['END', 'T4', 'PB', 'PA1'],
		];

		const finalState = await runTest(events, edges);

		expect(finalState?.get('m.room.topic:')).toHaveProperty('eventId', 'T3:example.com');

		expect(finalState?.get('m.room.power_levels:')).toHaveProperty('eventId', 'PA2:example.com');
	});

	it('successful mainline sort with no existing power level event', async () => {
		const createEvent = new FakeEvent('CREATE2', ALICE, 'm.room.create', '', {
			creator: ALICE,
		}).toEvent([], []);

		const aliceMemberEvent = new FakeEvent('IMA2', ALICE, 'm.room.member', ALICE, MEMBERSHIP_CONTENT_JOIN).toEvent(
			[createEvent.eventId],
			[createEvent.eventId],
		);

		const joinRuleEvent = new FakeEvent('IJR2', ALICE, 'm.room.join_rules', '', { join_rule: 'public' }).toEvent(
			[createEvent.eventId, aliceMemberEvent.eventId],
			[aliceMemberEvent.eventId],
		);

		const bobJoinEvent = new FakeEvent('IMB2', BOB, 'm.room.member', BOB, MEMBERSHIP_CONTENT_JOIN).toEvent(
			[createEvent.eventId, joinRuleEvent.eventId],
			[joinRuleEvent.eventId],
		);

		const events = [bobJoinEvent, joinRuleEvent, aliceMemberEvent, createEvent];

		for (const event of events) {
			eventStore.events.push(event);
		}

		const sortedEvents = events
			.sort((e1, e2) => {
				if (e1.originServerTs !== e2.originServerTs) {
					return e1.originServerTs - e2.originServerTs;
				}

				return e1.eventId.localeCompare(e2.eventId);
			})
			.map((e) => {
				return e.eventId;
			});

		const mainlineSorted = (await mainlineOrdering(events, eventStore)).map((e) => {
			return e.eventId;
		});

		expect(mainlineSorted).toEqual(sortedEvents);
	});

	it('kahns', () => {
		/*
			        graph: Dict[str, Set[str]] = {
	            "l": {"o"},
	            "m": {"n", "o"},
	            "n": {"o"},
	            "o": set(),
	            "p": {"o"},
	        }
	*/

		const graph = new Map<string, Set<string>>([
			['l', new Set(['o'])],
			['m', new Set(['n', 'o'])],
			['n', new Set(['o'])],
			['o', new Set()],
			['p', new Set(['o'])],
		]);

		const sorted = _kahnsOrder({
			indegreeGraph: graph,
			compareFunc: (a, b) => a.localeCompare(b),
		});

		expect(sorted).toEqual(['o', 'l', 'n', 'm', 'p']);
	});

	it('auth chain difference 1', async () => {
		const a = new FakeEvent('A', ALICE, 'm.room.member', '', {});
		const b = new FakeEvent('B', ALICE, 'm.room.member', '', {});
		const c = new FakeEvent('C', ALICE, 'm.room.member', '', {});

		const aEvent = a.toEvent([], []);
		const bEvent = b.toEvent([aEvent.eventId], []);
		const cEvent = c.toEvent([bEvent.eventId], []);

		const stateSets: Parameters<typeof getAuthChainDifference>[0] = [
			new Map([
				[`${aEvent.type}:` as const, aEvent.eventId],
				[`${bEvent.type}:` as const, bEvent.eventId],
			]),
			new Map([[`${cEvent.type}:` as const, cEvent.eventId]]),
		];

		eventStore.events.push(aEvent, bEvent, cEvent);

		const diff = await getAuthChainDifference(stateSets, eventStore);

		expect(diff).toEqual(new Set([c.event_id]));
	});

	it('auth chain difference 2', async () => {
		const a = new FakeEvent('A', ALICE, 'm.room.member', '', {});
		const b = new FakeEvent('B', ALICE, 'm.room.member', '', {});
		const c = new FakeEvent('C', ALICE, 'm.room.member', '', {});
		const d = new FakeEvent('D', ALICE, 'm.room.member', '', {});

		const aEvent = a.toEvent([], []);
		const bEvent = b.toEvent([aEvent.eventId], []);
		const cEvent = c.toEvent([bEvent.eventId], []);
		const dEvent = d.toEvent([cEvent.eventId], []);

		const stateSets: Parameters<typeof getAuthChainDifference>[0] = [
			new Map([
				[`${aEvent.type}:` as const, aEvent.eventId],
				[`${bEvent.type}:` as const, bEvent.eventId],
			]),
			new Map([
				[`${cEvent.type}:` as const, cEvent.eventId],
				[`${dEvent.type}:` as const, dEvent.eventId],
			]),
		];

		eventStore.events.push(aEvent, bEvent, cEvent, dEvent);

		const diff = await getAuthChainDifference(stateSets, eventStore);

		expect(diff).toEqual(new Set([d.event_id, c.event_id]));
	});

	it('auth chain difference 3', async () => {
		const a = new FakeEvent('A', ALICE, 'm.room.member', '', {});
		const b = new FakeEvent('B', ALICE, 'm.room.member', '', {});
		const c = new FakeEvent('C', ALICE, 'm.room.member', '', {});
		const d = new FakeEvent('D', ALICE, 'm.room.member', '', {});
		const e = new FakeEvent('E', ALICE, 'm.room.member', '', {});

		const aEvent = a.toEvent([], []);
		const bEvent = b.toEvent([aEvent.eventId], []);
		const cEvent = c.toEvent([bEvent.eventId], []);
		const dEvent = d.toEvent([cEvent.eventId], []);
		const eEvent = e.toEvent([cEvent.eventId, bEvent.eventId], []);

		const stateSets: Parameters<typeof getAuthChainDifference>[0] = [
			new Map([
				[`${aEvent.type}:` as const, aEvent.eventId],
				[`${bEvent.type}:` as const, bEvent.eventId],
				[`${eEvent.type}:` as const, eEvent.eventId],
			]),
			new Map([
				[`${cEvent.type}:` as const, cEvent.eventId],
				[`${dEvent.type}:` as const, dEvent.eventId],
			]),
		];

		eventStore.events.push(aEvent, bEvent, cEvent, dEvent, eEvent);

		const diff = await getAuthChainDifference(stateSets, eventStore);

		expect(diff).toEqual(new Set([dEvent.eventId, eEvent.eventId]));
	});

	it('should resolve correct state based on auth chain difference', async () => {
		const events = [
			// two memberships
			// one join rule
			new FakeEvent('EB', EVELYN, 'm.room.member', EVELYN, MEMBERSHIP_CONTENT_JOIN),
			new FakeEvent('JRI', ALICE, 'm.room.join_rules', '', {
				join_rule: 'invite',
			}),
		];

		const edges = [
			['END', 'EB', 'IJR'],
			['END', 'JRI', 'IJR'],
		];

		const finalState = await runTest(events, edges);

		expect(finalState.get('m.room.join_rules:')).toHaveProperty('eventId', 'JRI:example.com');
		expect(finalState.get('m.room.member:@evelyn:example.com')).toBeUndefined();
	});
});
