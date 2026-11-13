import { describe, expect, it } from 'bun:test';

import { resolveStateV2Plus } from './v2';
import type { PersistentEventBase } from '../../../manager/event-wrapper';
import { PersistentEventFactory } from '../../../manager/factory';
import type { EventID, RoomID, StateMapKey, UserID } from '../../../types/_common';
import { type EventStore, getConflictedStateSubgraph, partitionStateSets } from '../definitions';

class MockEventStore implements EventStore {
	events = new Map<EventID, PersistentEventBase>();

	add(...events: PersistentEventBase[]) {
		for (const event of events) {
			this.events.set(event.eventId, event);
		}
	}

	async getEvents(eventIds: EventID[]): Promise<PersistentEventBase[]> {
		return eventIds.map((id) => this.events.get(id)).filter((event): event is PersistentEventBase => event !== undefined);
	}
}

const alice = '@alice:example.com' as UserID;
const bob = '@bob:example.com' as UserID;
const carol = '@carol:example.com' as UserID;

let ts = 0;

function stateEvent(
	roomId: RoomID,
	type: 'm.room.member' | 'm.room.power_levels' | 'm.room.join_rules' | 'm.room.topic',
	sender: UserID,
	content: Record<string, unknown>,
	authEvents: PersistentEventBase[],
	stateKey = '',
) {
	ts += 1;
	return PersistentEventFactory.createFromRawEvent(
		{
			type,
			sender,
			state_key: stateKey,
			room_id: roomId,
			content,
			origin_server_ts: ts,
			depth: ts,
			prev_events: [],
			auth_events: authEvents.map((event) => event.eventId),
		} as never,
		'12',
	);
}

function stateOf(...events: PersistentEventBase[]) {
	return new Map<StateMapKey, PersistentEventBase>(events.map((event) => [event.getUniqueStateIdentifier(), event]));
}

describe('state res v2.1', () => {
	describe('conflicted state subgraph', () => {
		const roomId = '!subgraph:example.com' as RoomID;
		const topic = (name: string, authEvents: PersistentEventBase[]) =>
			stateEvent(roomId, 'm.room.topic', alice, { topic: name }, authEvents);

		it('includes the events on an auth path between two conflicted events', async () => {
			const store = new MockEventStore();
			const a = topic('a', []);
			const b = topic('b', [a]);
			const c = topic('c', [b]);
			store.add(a, b, c);

			expect(await getConflictedStateSubgraph(new Set([a.eventId, c.eventId]), store)).toEqual(new Set([a.eventId, b.eventId, c.eventId]));
		});

		it('is empty when no conflicted event reaches another', async () => {
			const store = new MockEventStore();
			const a = topic('a', []);
			const b = topic('b', [a]);
			const d = topic('d', [a]);
			store.add(a, b, d);

			expect(await getConflictedStateSubgraph(new Set([b.eventId, d.eventId]), store)).toEqual(new Set());
		});

		it('includes every branch of a diamond', async () => {
			const store = new MockEventStore();
			const a = topic('a', []);
			const b = topic('b', [a]);
			const c = topic('c', [a]);
			const d = topic('d', [b, c]);
			store.add(a, b, c, d);

			expect(await getConflictedStateSubgraph(new Set([a.eventId, d.eventId]), store)).toEqual(
				new Set([a.eventId, b.eventId, c.eventId, d.eventId]),
			);
		});
	});

	describe('partitionStateSets', () => {
		const roomId = '!partition:example.com' as RoomID;

		it('treats a key missing from some states as conflicted', () => {
			const shared = stateEvent(roomId, 'm.room.topic', alice, { topic: 'shared' }, []);
			const onlyOne = stateEvent(roomId, 'm.room.member', bob, { membership: 'join' }, [], bob);

			const [unconflicted, conflicted] = partitionStateSets([stateOf(shared, onlyOne), stateOf(shared)]);

			expect(unconflicted).toEqual(new Map([[shared.getUniqueStateIdentifier(), shared.eventId]]));
			expect(conflicted).toEqual(new Map([[onlyOne.getUniqueStateIdentifier(), [onlyOne.eventId]]]));
		});

		it('collects every distinct value of a conflicted key', () => {
			const a = stateEvent(roomId, 'm.room.topic', alice, { topic: 'a' }, []);
			const b = stateEvent(roomId, 'm.room.topic', alice, { topic: 'b' }, []);

			const [unconflicted, conflicted] = partitionStateSets([stateOf(a), stateOf(b), stateOf(a)]);

			expect(unconflicted.size).toBe(0);
			expect(conflicted.get(a.getUniqueStateIdentifier())).toEqual([a.eventId, b.eventId]);
		});
	});

	describe('a v12 room', () => {
		// alice creates the room and outranks everyone; bob holds PL 100. both change the power levels concurrently
		function room() {
			const store = new MockEventStore();

			const create = PersistentEventFactory.newCreateEvent(alice, '12');
			const { roomId } = create;

			const aliceJoin = stateEvent(roomId, 'm.room.member', alice, { membership: 'join' }, [], alice);
			const powerLevels = stateEvent(roomId, 'm.room.power_levels', alice, { users: { [bob]: 100 }, users_default: 0 }, [aliceJoin]);
			const joinRules = stateEvent(roomId, 'm.room.join_rules', alice, { join_rule: 'public' }, [powerLevels, aliceJoin]);
			const bobJoin = stateEvent(roomId, 'm.room.member', bob, { membership: 'join' }, [powerLevels, joinRules], bob);

			store.add(create, aliceJoin, powerLevels, joinRules, bobJoin);

			const base = [create, aliceJoin, powerLevels, joinRules, bobJoin];

			return { store, roomId, create, aliceJoin, powerLevels, joinRules, bobJoin, base };
		}

		it('resolves without the create event in any auth chain', async () => {
			const { store, roomId, aliceJoin, powerLevels, base } = room();

			const topicA = stateEvent(roomId, 'm.room.topic', alice, { topic: 'a' }, [powerLevels, aliceJoin]);
			const topicB = stateEvent(roomId, 'm.room.topic', alice, { topic: 'b' }, [powerLevels, aliceJoin]);
			store.add(topicA, topicB);

			const resolved = await resolveStateV2Plus([stateOf(...base, topicA), stateOf(...base, topicB)], store, 'v2.1');

			expect(resolved.get('m.room.create:')?.eventId).toBe(base[0].eventId);
			// the unconflicted power levels are not in the partial state, so mainline ties and the later ts wins
			expect(resolved.get('m.room.topic:')?.eventId).toBe(topicB.eventId);
		});

		it('orders the creator before any power level, so a concurrent PL 100 change loses', async () => {
			const { store, roomId, aliceJoin, powerLevels, bobJoin, base } = room();

			// bob's change comes first in time, a tie on power level would let it win
			const byBob = stateEvent(roomId, 'm.room.power_levels', bob, { users: { [bob]: 100, [carol]: 50 }, users_default: 0 }, [
				powerLevels,
				bobJoin,
			]);
			const byAlice = stateEvent(roomId, 'm.room.power_levels', alice, { users: {}, users_default: 0 }, [powerLevels, aliceJoin]);
			store.add(byBob, byAlice);

			const resolved = await resolveStateV2Plus([stateOf(...base, byBob), stateOf(...base, byAlice)], store, 'v2.1');

			expect(resolved.get('m.room.power_levels:')?.eventId).toBe(byAlice.eventId);
		});

		it('keeps every unconflicted entry when starting from an empty state', async () => {
			const { store, roomId, aliceJoin, powerLevels, base } = room();

			const topicA = stateEvent(roomId, 'm.room.topic', alice, { topic: 'a' }, [powerLevels, aliceJoin]);
			const topicB = stateEvent(roomId, 'm.room.topic', alice, { topic: 'b' }, [powerLevels, aliceJoin]);
			store.add(topicA, topicB);

			const resolved = await resolveStateV2Plus([stateOf(...base, topicA), stateOf(...base, topicB)], store, 'v2.1');

			for (const event of base) {
				expect(resolved.get(event.getUniqueStateIdentifier())?.eventId).toBe(event.eventId);
			}
		});
	});
});
