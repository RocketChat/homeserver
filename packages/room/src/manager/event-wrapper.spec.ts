import { PersistentEventFactory } from './factory';

import { describe, expect, it } from 'bun:test';
import type { Pdu } from '../types/v3-11';
import type { RoomVersion } from './type';

function runTest(
	event: Parameters<typeof PersistentEventFactory.createFromRawEvent>[0],
	expected: any,
	roomVersion: RoomVersion = '10',
) {
	expect(
		PersistentEventFactory.createFromRawEvent(event, roomVersion as RoomVersion)
			.redactedRawEvent,
	).toEqual(expected);
}

describe('[EventWrapper] Redaction', () => {
	it('minimal', () => {
		runTest(
			{
				// @ts-expect-error our types are production types
				type: 'A',
				event_id: '$test:domain',
			},
			{
				type: 'A',
				event_id: '$test:domain',
				content: {},
				signatures: {},
				unsigned: {},
			},
		);
	});

	it('basic keysi, Ensure that the keys that should be untouched are kept.', () => {
		const a = {
			event_id: '$3:domain',
			type: 'A',
			room_id: '!1:domain',
			sender: '@2:domain',
			state_key: 'B',
			content: { other_key: 'foo' },
			hashes: 'hashes',
			signatures: { domain: { 'algo:1': 'sigs' } },
			depth: 4,
			prev_events: 'prev_events',
			prev_state: 'prev_state',
			auth_events: 'auth_events',
			origin: 'domain',
			origin_server_ts: 1234,
			membership: 'join',
			other_key: 'foo',
		};
		const b = {
			event_id: '$3:domain',
			type: 'A',
			room_id: '!1:domain',
			sender: '@2:domain',
			state_key: 'B',
			hashes: 'hashes',
			depth: 4,
			prev_events: 'prev_events',
			prev_state: 'prev_state',
			auth_events: 'auth_events',
			origin: 'domain',
			origin_server_ts: 1234,
			membership: 'join',
			content: {},
			signatures: { domain: { 'algo:1': 'sigs' } },
			unsigned: {},
		};

		// @ts-expect-error our types are production types
		runTest(a, b);

		const a2 = {
			type: 'A',
			prev_state: 'prev_state',
			membership: 'join',
			origin: 'example.com',
		};
		const b2 = { type: 'A', content: {}, signatures: {}, unsigned: {} };
		// @ts-expect-error our types are production types
		runTest(a2, b2, '11');
	});

	it('unsigned, Ensure that unsigned properties get stripped (except age_ts and replaces_state).', () => {
		const a = {
			type: 'B',
			event_id: '$test:domain',
			unsigned: {
				age_ts: 20,
				replaces_state: '$test2:domain',
				other_key: 'foo',
			},
		};
		const b = {
			type: 'B',
			event_id: '$test:domain',
			content: {},
			signatures: {},
			unsigned: { age_ts: 20, replaces_state: '$test2:domain' },
		};

		// @ts-expect-error our types are production types
		runTest(a, b);
	});

	it('content, The content dictionary should be stripped in most cases.', () => {
		const a = {
			type: 'C',
			event_id: '$test:domain',
			content: { things: 'here' },
		};
		const b = {
			type: 'C',
			event_id: '$test:domain',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error our types are production types
		runTest(a, b);

		const eventsToKeepContentKeys = [
			['member', 'membership', 'join'],
			['join_rules', 'join_rule', 'invite'],
			['history_visibility', 'history_visibility', 'shared'],
		];

		for (const [eventType, key, value] of eventsToKeepContentKeys) {
			const a = {
				type: `m.room.${eventType}`,
				event_id: '$test:domain',
				content: { [key]: value, other_key: 'foo' },
			};
			const b = {
				type: `m.room.${eventType}`,
				event_id: '$test:domain',
				content: { [key]: value },
				signatures: {},
				unsigned: {},
			};
			runTest(a, b);
		}
	});

	it('create, Create events are partially redacted until MSC2176.', () => {
		const a = {
			type: 'm.room.create',
			event_id: '$test:domain',
			content: { creator: '@2:domain', other_key: 'foo' },
		};
		const b = {
			type: 'm.room.create',
			event_id: '$test:domain',
			content: { creator: '@2:domain' },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error other_key  IS invalid and should be stripped
		runTest(a, b);

		const a2 = {
			type: 'm.room.create',
			content: { not_a_real_key: true },
			origin: 'some_homeserver',
			nonsense_field: 'some_random_garbage',
		};
		const b2 = {
			type: 'm.room.create',
			content: { not_a_real_key: true },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error not_a_real_key IS invalid but point is to test redaction
		runTest(a2, b2, '11');
	});

	it('power levels, Power level events keep a variety of content keys.', () => {
		const a: Parameters<typeof runTest>[0] = {
			type: 'm.room.power_levels',
			event_id: '$test:domain',
			content: {
				ban: 1,
				events: { 'm.room.name': 100 },
				events_default: 2,
				invite: 3,
				kick: 4,
				redact: 5,
				state_default: 6,
				users: { '@admin:domain': 100 },
				users_default: 7,
				// @ts-expect-error other_key IS invalid and should be stripped
				other_key: 8,
			},
		};
		const b = {
			type: 'm.room.power_levels',
			event_id: '$test:domain',
			content: {
				ban: 1,
				events: { 'm.room.name': 100 },
				events_default: 2,
				kick: 4,
				redact: 5,
				state_default: 6,
				users: { '@admin:domain': 100 },
				users_default: 7,
			},
			signatures: {},
			unsigned: {},
		};

		runTest(a, b);

		const a2 = {
			type: 'm.room.power_levels',
			content: { invite: 75 },
		};
		const b2 = {
			type: 'm.room.power_levels',
			content: { invite: 75 },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error
		runTest(a2, b2, '11');
	});

	it('alias, Alias events have special behavior up through room version 6.', () => {
		const a = {
			type: 'm.room.aliases',
			event_id: '$test:domain',
			content: { aliases: ['test'] },
		};
		const b = {
			type: 'm.room.aliases',
			event_id: '$test:domain',
			content: { aliases: ['test'] },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '5' /* < 6 */);

		const a2 = { type: 'm.room.aliases', content: { aliases: ['test'] } };
		const b2 = {
			type: 'm.room.aliases',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a2, b2, '6');
	});

	it('redaction, Redaction events have no special behaviour until MSC2174/MSC2176.', () => {
		const a = {
			type: 'm.room.redaction',
			content: { redacts: '$test2:domain' },
			redacts: '$test2:domain',
		};
		const b = {
			type: 'm.room.redaction',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '6');

		const a2 = {
			type: 'm.room.redaction',
			content: { redacts: '$test2:domain' },
			redacts: '$test2:domain',
		};
		const b2 = {
			type: 'm.room.redaction',
			content: { redacts: '$test2:domain' },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a2, b2, '11');
	});

	it('join rules, Join rules events have changed behavior starting with MSC3083.', () => {
		const a = {
			type: 'm.room.join_rules',
			event_id: '$test:domain',
			content: {
				join_rule: 'invite',
				allow: [],
				other_key: 'stripped',
			},
		};
		const b = {
			type: 'm.room.join_rules',
			event_id: '$test:domain',
			content: { join_rule: 'invite' },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '7');

		// @ts-expect-error just redactions
		runTest(a, { ...b, content: { join_rule: 'invite', allow: [] } }, '8');
	});

	it('member, Member events have changed behavior in MSC3375 and MSC3821.', () => {
		const a2 = {
			type: 'm.room.member',
			content: {
				membership: 'join',
				join_authorised_via_users_server: '@user:domain',
				other_key: 'stripped',
			},
		};
		const b2 = {
			type: 'm.room.member',
			content: {
				membership: 'join',
				join_authorised_via_users_server: '@user:domain',
			},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a2, b2, '9');
		// TODO 3pid invite
	});

	it('relations, Event relations get redacted until MSC3389.', () => {
		const a = {
			type: 'm.room.message',
			content: {
				body: 'foo',
				'm.relates_to': {
					rel_type: 'rel_type',
					event_id: '$parent:domain',
					other: 'stripped',
				},
			},
		};
		const b = {
			type: 'm.room.message',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '10');

		// rest of the tests not yet part of normal standard
	});

	it('correctly calculate new depth', () => {
		const e1 = PersistentEventFactory.createFromRawEvent(
			{ depth: 1 } as Pdu,
			'10',
		);
		const e2 = PersistentEventFactory.createFromRawEvent(
			{ depth: 1 } as Pdu,
			'10',
		).addPrevEvents([e1]);
		expect(e2.depth).toBe(2);
		const e3 = PersistentEventFactory.createFromRawEvent(
			{ depth: 5 } as Pdu,
			'10',
		);
		e2.addPrevEvents([e3]);
		expect(e2.depth).toBe(6);

		const e4 = PersistentEventFactory.createFromRawEvent(
			{ depth: 4 } as Pdu,
			'10',
		);
		const e5 = PersistentEventFactory.createFromRawEvent(
			{ depth: 7 } as Pdu,
			'10',
		);

		e2.addPrevEvents([e5, e4]); // intentional out of order
		expect(e2.depth).toBe(8);
	});
});
