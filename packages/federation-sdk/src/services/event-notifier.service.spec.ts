import { beforeEach, describe, expect, test } from 'bun:test';

import { type Pdu, PersistentEventFactory } from '@rocket.chat/federation-room';

import { EventEmitterService } from './event-emitter.service';
import { EventNotifierService } from './event-notifier.service';
import type { StateService } from './state.service';

const ROOM_ID = '!room:remote.example.com';
const ALICE = '@alice:remote.example.com';

function receivedPdu(fields: Record<string, unknown>) {
	return PersistentEventFactory.createFromRawEvent(
		{
			room_id: ROOM_ID,
			sender: ALICE,
			origin_server_ts: 1700000000000,
			depth: 7,
			auth_events: ['$auth:remote.example.com'],
			prev_events: ['$prev:remote.example.com'],
			...fields,
		} as unknown as Pdu,
		'10',
	);
}

describe('EventNotifierService', () => {
	let emitter: EventEmitterService;
	let notifier: EventNotifierService;
	const emitted: { name: string; payload: { event_id: string; event: Record<string, unknown>; sticky?: { expiresAt: number } } }[] = [];

	beforeEach(() => {
		emitter = new EventEmitterService();
		notifier = new EventNotifierService(emitter, {} as StateService);
		emitted.length = 0;

		for (const name of ['homeserver.matrix.event', 'homeserver.matrix.message', 'homeserver.matrix.membership'] as const) {
			emitter.on(name, (payload) => {
				emitted.push({ name, payload: payload as (typeof emitted)[number]['payload'] });
			});
		}
	});

	test('notifies a pdu of a type without a typed notification, with every field it was received with', async () => {
		const pdu = receivedPdu({
			type: 'org.matrix.msc3401.call.member',
			state_key: `_${ALICE}_DEVICE_m.call`,
			content: { application: 'm.call', call_id: '', device_id: 'DEVICE' },
			unsigned: { age: 1234 },
			sticky: { duration_ms: 3600000 },
		});

		await notifier.notify(pdu);

		expect(emitted).toHaveLength(1);
		expect(emitted[0].name).toBe('homeserver.matrix.event');
		expect(emitted[0].payload.event_id).toBe(pdu.eventId);
		expect(emitted[0].payload.event).toMatchObject({
			type: 'org.matrix.msc3401.call.member',
			state_key: `_${ALICE}_DEVICE_m.call`,
			content: { application: 'm.call', call_id: '', device_id: 'DEVICE' },
			sender: ALICE,
			room_id: ROOM_ID,
			origin_server_ts: 1700000000000,
			unsigned: { age: 1234 },
			sticky: { duration_ms: 3600000 },
		});
		expect(emitted[0].payload).not.toHaveProperty('sticky');
	});

	test('tells when the stickiness of a sticky pdu ends', async () => {
		const pdu = receivedPdu({
			type: 'org.matrix.msc4143.rtc.member',
			content: { msc4354_sticky_key: 'member-1' },
			msc4354_sticky: { duration_ms: 3600000 },
		});

		await notifier.notify(pdu, { sticky: { expiresAt: 1700003600000 } });

		expect(emitted[0].payload).toMatchObject({
			event_id: pdu.eventId,
			event: { msc4354_sticky: { duration_ms: 3600000 } },
			sticky: { expiresAt: 1700003600000 },
		});
	});

	test('notifies a state event whose content is empty', async () => {
		const pdu = receivedPdu({
			type: 'org.matrix.msc3401.call.member',
			state_key: `_${ALICE}_DEVICE_m.call`,
			content: {},
		});

		await notifier.notify(pdu);

		expect(emitted.map(({ name }) => name)).toEqual(['homeserver.matrix.event']);
		expect(emitted[0].payload.event.content).toEqual({});
	});

	test.each([
		['m.room.message', 'homeserver.matrix.message', { content: { msgtype: 'm.text', body: 'hi' } }],
		['m.room.member', 'homeserver.matrix.membership', { state_key: ALICE, content: { membership: 'join' } }],
	])('notifies a %s pdu through its typed notification first, then generically', async (type, typedName, fields) => {
		const pdu = receivedPdu({ type, ...fields });

		await notifier.notify(pdu);

		expect(emitted.map(({ name }) => name)).toEqual([typedName, 'homeserver.matrix.event']);
		expect(emitted[1].payload).toEqual(emitted[0].payload);
	});
});
