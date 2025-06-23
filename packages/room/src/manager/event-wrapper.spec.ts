import type { EventStore } from '../state_resolution/definitions/definitions';
import type { PduV1 } from '../types/v1';
import { PersistentEventBase } from './event-wrapper';
import { PersistentEventFactory } from './factory';

import { it, describe, expect, afterEach } from 'bun:test';

class MockStore implements EventStore {
	events: Map<string, PersistentEventBase> = new Map();

	async getEvents(eventIds: string[]): Promise<PersistentEventBase[]> {
		return eventIds.map(
			(eventId) => this.events.get(eventId) as PersistentEventBase,
		);
	}

	async getEventsByHashes(hashes: string[]): Promise<PersistentEventBase[]> {
		const byHash = new Map<string, PersistentEventBase>();
		for (const [, event] of this.events) {
			byHash.set(event.sha256hash.toString(), event);
		}

		return hashes.map((h) => byHash.get(h) as PersistentEventBase);
	}
}

const store = new MockStore();

describe('EventManager', () => {
	afterEach(() => {
		store.events.clear();
	});

	it('should handle auth_event differences in v1', async () => {
		const createEvent = PersistentEventFactory.createFromRawEvent(
			{
				event_id: 'create',
				room_id: '!1234567890:example.com',
				type: 'm.room.create' as const,
				state_key: '',
				content: {
					creator: 'alice',
					room_version: '1',
				},
				auth_events: [] as string[],
				prev_events: [] as string[],
			} as PduV1,
			'1',
		);

		const events = [
			PersistentEventFactory.createFromRawEvent(
				{
					event_id: 'join',
					room_id: '!1234567890:example.com',
					type: 'm.room.member',
					state_key: '@alice:example.com',
					content: {
						membership: 'join',
					},
					auth_events: ['create'],
					prev_events: [] as string[],
				} as PduV1,
				'1',
			),
			PersistentEventFactory.createFromRawEvent(
				{
					event_id: 'message',
					room_id: '!1234567890:example.com',
					type: 'm.room.message',
					state_key: '',
					content: {
						msgtype: 'm.text',
						body: 'Hello, world!',
					},
					auth_events: [
						{ sha256: createEvent.sha256hash.toString() },
						'join',
					] as (string | { sha256: string })[],
					prev_events: [] as string[],
				} as unknown as PduV1,
				'1',
			),
		];

		store.events.set('create', createEvent);
		store.events.set('join', events[0]);
		store.events.set('message', events[1]);

		const messageEvent = events[1];

		const authEvents = await messageEvent.getAuthorizationEvents(store);

		const ids = authEvents.map((e) => e.eventId);

		expect(ids).toEqual(['join', 'create']);
	});
});
