import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { type Pdu, PersistentEventFactory, RejectCodes, type RoomID } from '@rocket.chat/federation-room';

import { StickyEventService } from './sticky-event.service';
import type { EventRepository } from '../repositories/event.repository';

const ROOM_ID = '!room:hs1' as RoomID;
const SENT_AT = 1_700_000_000_000;

function messageEvent(fields: Record<string, unknown> = {}) {
	return PersistentEventFactory.createFromRawEvent(
		{
			type: 'org.matrix.msc4143.rtc.member',
			content: { msc4354_sticky_key: 'member-1' },
			room_id: ROOM_ID,
			sender: '@alice:hs2',
			origin_server_ts: SENT_AT,
			depth: 3,
			auth_events: [],
			prev_events: [],
			...fields,
		} as unknown as Pdu,
		'10',
	);
}

describe('StickyEventService', () => {
	let service: StickyEventService;
	let setSticky: ReturnType<typeof mock>;
	let findActiveStickyByRoomId: ReturnType<typeof mock>;

	beforeEach(() => {
		setSticky = mock(async () => undefined);
		findActiveStickyByRoomId = mock(() => ({ toArray: async () => [] }));

		service = new StickyEventService({ setSticky, findActiveStickyByRoomId } as unknown as EventRepository);
	});

	describe('markSticky', () => {
		test('records when the stickiness of a sticky event ends', async () => {
			const event = messageEvent({ msc4354_sticky: { duration_ms: 3_600_000 } });

			const expiresAt = await service.markSticky(event, SENT_AT + 1_000);

			expect(expiresAt).toBe(SENT_AT + 3_600_000);
			expect(setSticky).toHaveBeenCalledWith(event.eventId, { receivedAt: SENT_AT + 1_000, expiresAt: SENT_AT + 3_600_000 });
		});

		test('records nothing for an event that is not sticky', async () => {
			expect(await service.markSticky(messageEvent(), SENT_AT)).toBeUndefined();
			expect(setSticky).not.toHaveBeenCalled();
		});

		test('never makes a rejected event sticky', async () => {
			const event = messageEvent({ msc4354_sticky: { duration_ms: 3_600_000 } });
			event.reject(RejectCodes.AuthError, 'not allowed');

			expect(await service.markSticky(event, SENT_AT)).toBeUndefined();
			expect(setSticky).not.toHaveBeenCalled();
		});
	});

	describe('getActiveStickyEvents', () => {
		test('lists the unexpired sticky events of a room with when each one ends', async () => {
			const event = messageEvent({ msc4354_sticky: { duration_ms: 3_600_000 } });
			findActiveStickyByRoomId.mockImplementationOnce(() => ({
				toArray: async () => [{ _id: event.eventId, event: event.event, sticky: { receivedAt: SENT_AT, expiresAt: SENT_AT + 3_600_000 } }],
			}));

			const active = await service.getActiveStickyEvents(ROOM_ID, { type: 'org.matrix.msc4143.rtc.member', now: SENT_AT + 10 });

			expect(findActiveStickyByRoomId).toHaveBeenCalledWith(ROOM_ID, SENT_AT + 10, 'org.matrix.msc4143.rtc.member');
			expect(active).toEqual([{ event_id: event.eventId, event: event.event, expiresAt: SENT_AT + 3_600_000 }]);
		});

		test('counts from the current time by default', async () => {
			const before = Date.now();

			await service.getActiveStickyEvents(ROOM_ID);

			const [, now, type] = findActiveStickyByRoomId.mock.calls[0];
			expect(now).toBeGreaterThanOrEqual(before);
			expect(type).toBeUndefined();
		});
	});
});
