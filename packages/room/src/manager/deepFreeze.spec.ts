import { deepFreeze } from './event-wrapper';

import { describe, expect, it } from 'bun:test';

describe('[EventWrapper] Deep Freeze', () => {
	it('should freeze all nested values', () => {
		const event = {
			type: 'm.room.message',
			content: {
				body: 'foo',
				'm.relates_to': {
					rel_type: 'rel_type',
					event_id: '$parent:domain',
					other: 'stripped',
				},
			},
			prev_events: ['event1', 'event2'],
			auth_events: ['event3', 'event4'],
		};

		deepFreeze(event);

		expect(() => {
			event.prev_events.push('event5');
		}).toThrow();

		expect(() => {
			event.content.body = 'bar';
		}).toThrow();
	});
});
