import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { type Pdu, PersistentEventFactory, RejectCodes, type RoomID, type State } from '@rocket.chat/federation-room';

import type { ConfigService } from './config.service';
import type { FederationSenderService } from './federation-sender.service';
import type { StateService } from './state.service';
import { NEW_SERVER_CATCH_UP_DELAY_MS, StickyEventService } from './sticky-event.service';
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
	let getServerSetInRoom: ReturnType<typeof mock>;
	let getStateBeforeEvent: ReturnType<typeof mock>;
	let sendPDU: ReturnType<typeof mock>;

	beforeEach(() => {
		setSticky = mock(async () => undefined);
		findActiveStickyByRoomId = mock(() => ({ toArray: async () => [] }));
		getServerSetInRoom = mock(async () => new Set(['hs1', 'hs2']));
		getStateBeforeEvent = mock(async () => new Map());
		sendPDU = mock(() => undefined);

		service = new StickyEventService(
			{ setSticky, findActiveStickyByRoomId } as unknown as EventRepository,
			{ serverName: 'hs1' } as ConfigService,
			{ getServerSetInRoom, getStateBeforeEvent } as unknown as StateService,
			{ sendPDU } as unknown as FederationSenderService,
		);
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

	describe('pushOwnStickyEvents', () => {
		test("queues this server's own unexpired sticky events of the room to the destination, oldest first", async () => {
			const own1 = messageEvent({ sender: '@alice:hs1', origin_server_ts: SENT_AT, msc4354_sticky: { duration_ms: 3_600_000 } });
			const remote = messageEvent({ sender: '@bob:hs2', origin_server_ts: SENT_AT + 1, msc4354_sticky: { duration_ms: 3_600_000 } });
			const own2 = messageEvent({ sender: '@carol:hs1', origin_server_ts: SENT_AT + 2, msc4354_sticky: { duration_ms: 110_000 } });
			findActiveStickyByRoomId.mockImplementationOnce(() => ({
				toArray: async () => [own1, remote, own2].map((e) => ({ _id: e.eventId, event: e.event, sticky: { receivedAt: 0, expiresAt: 0 } })),
			}));

			const before = Date.now();
			const count = await service.pushOwnStickyEvents(ROOM_ID, 'hs3');

			const [roomId, now] = findActiveStickyByRoomId.mock.calls[0];
			expect(roomId).toBe(ROOM_ID);
			expect(now).toBeGreaterThanOrEqual(before);
			expect(count).toBe(2);
			expect(sendPDU.mock.calls).toEqual([
				['hs3', own1.event],
				['hs3', own2.event],
			]);
		});

		test('never throws', async () => {
			findActiveStickyByRoomId.mockImplementationOnce(() => {
				throw new Error('db down');
			});

			expect(await service.pushOwnStickyEvents(ROOM_ID, 'hs3')).toBe(0);
		});
	});

	describe('catchUpIfNewServer', () => {
		let scheduled: { callback: () => void; delayMs: number | undefined }[];
		let setTimeoutSpy: ReturnType<typeof spyOn>;

		const membership = (stateKey: string, membership: string) =>
			PersistentEventFactory.createFromRawEvent(
				{
					type: 'm.room.member',
					state_key: stateKey,
					content: { membership },
					room_id: ROOM_ID,
					sender: stateKey,
					origin_server_ts: SENT_AT,
					depth: 4,
					auth_events: [],
					prev_events: [],
				} as unknown as Pdu,
				'10',
			);

		beforeEach(() => {
			scheduled = [];
			setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delayMs?: number) => {
				scheduled.push({ callback, delayMs });
				return { unref: () => undefined };
			}) as unknown as typeof setTimeout);
		});

		afterEach(() => {
			setTimeoutSpy.mockRestore();
		});

		test('catches up the server of the first member that joins from it, after a delay', async () => {
			const pushOwnStickyEvents = spyOn(service, 'pushOwnStickyEvents').mockImplementation(async () => 0);
			const join = membership('@dave:hs3', 'join');

			expect(await service.catchUpIfNewServer(join)).toBe('hs3');

			expect(getStateBeforeEvent).toHaveBeenCalledWith(join);
			expect(scheduled).toHaveLength(1);
			expect(scheduled[0].delayMs).toBe(NEW_SERVER_CATCH_UP_DELAY_MS);
			expect(pushOwnStickyEvents).not.toHaveBeenCalled();

			scheduled[0].callback();
			expect(pushOwnStickyEvents).toHaveBeenCalledWith(ROOM_ID, 'hs3');
		});

		test('uses the given state before the join instead of looking it up', async () => {
			const stateBefore = new Map() as State;

			await service.catchUpIfNewServer(membership('@dave:hs3', 'join'), stateBefore);

			expect(getStateBeforeEvent).not.toHaveBeenCalled();
			expect(getServerSetInRoom).toHaveBeenCalledWith(ROOM_ID, stateBefore);
		});

		test('does nothing when the server already had a member in the room', async () => {
			expect(await service.catchUpIfNewServer(membership('@bob2:hs2', 'join'))).toBeUndefined();
			expect(scheduled).toHaveLength(0);
		});

		test('does nothing when a member of this server joins', async () => {
			expect(await service.catchUpIfNewServer(membership('@alice2:hs1', 'join'))).toBeUndefined();
			expect(getServerSetInRoom).not.toHaveBeenCalled();
			expect(scheduled).toHaveLength(0);
		});

		test.each(['invite', 'leave', 'ban', 'knock'])('does nothing for a %s', async (change) => {
			expect(await service.catchUpIfNewServer(membership('@dave:hs3', change))).toBeUndefined();
			expect(scheduled).toHaveLength(0);
		});

		test('does nothing for an event that is not a membership change', async () => {
			expect(await service.catchUpIfNewServer(messageEvent())).toBeUndefined();
			expect(getServerSetInRoom).not.toHaveBeenCalled();
		});

		test('never throws', async () => {
			getStateBeforeEvent.mockImplementationOnce(async () => {
				throw new Error('no state');
			});

			expect(await service.catchUpIfNewServer(membership('@dave:hs3', 'join'))).toBeUndefined();
			expect(scheduled).toHaveLength(0);
		});
	});
});
