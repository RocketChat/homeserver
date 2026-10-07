import { describe, expect, it, mock } from 'bun:test';

import type { EventID, Pdu, PduForType, RoomVersion } from '@rocket.chat/federation-room';
import { PersistentEventFactory, RejectCodes, StateResolverAuthorizationError } from '@rocket.chat/federation-room';

import type { EventNotifierService } from './event-notifier.service';
import { EventService } from './event.service';
import type { StateService } from './state.service';
import type { StickyEventService } from './sticky-event.service';
import type { EventRepository } from '../repositories/event.repository';

// a v10-shaped member event: pre-v11 redaction keeps origin/prev_state/membership at the top level,
// and only `membership` out of content
const memberEvent = {
	type: 'm.room.member',
	room_id: '!room:hs1',
	sender: '@alice:hs1',
	state_key: '@alice:hs1',
	depth: 5,
	auth_events: ['$auth1'],
	prev_events: ['$prev1'],
	origin_server_ts: 1732999153019,
	origin: 'hs1',
	prev_state: [],
	membership: 'join',
	content: {
		membership: 'join',
		displayname: 'alice',
		avatar_url: 'mxc://hs1/abc',
	},
	hashes: { sha256: 'irrelevant-to-redaction' },
	signatures: { hs1: { 'ed25519:key': 'sig' } },
	unsigned: { age: 2 },
} as unknown as Pdu;

function buildService(roomVersion: RoomVersion, storedEvent: Pdu) {
	const captured: { eventId?: EventID; event?: Pdu } = {};

	const eventRepository = {
		async findById() {
			return { event: storedEvent };
		},
		async redactEvent(eventId: EventID, redactedEvent: Pdu) {
			captured.eventId = eventId;
			captured.event = redactedEvent;
		},
	} as unknown as EventRepository;

	const stateService = {
		async getRoomVersion() {
			return roomVersion;
		},
	} as unknown as StateService;

	const service = new EventService(
		null as never,
		null as never,
		stateService,
		null as never,
		null as never,
		eventRepository,
		null as never,
		null as never,
		null as never,
	);

	return { service, captured };
}

describe('processRedaction', () => {
	it('keeps the pre-v11 top level fields when redacting in a v10 room', async () => {
		const { service, captured } = buildService('10', memberEvent);

		// before v11 the redaction target is a top level field
		const redaction = {
			type: 'm.room.redaction',
			room_id: '!room:hs1',
			sender: '@alice:hs1',
			depth: 6,
			auth_events: [],
			prev_events: [],
			origin_server_ts: 1732999153020,
			redacts: '$target' as EventID,
			content: {},
		} as unknown as PduForType<'m.room.redaction'>;

		await service.processRedaction(redaction);

		expect(captured.eventId).toBe('$target' as EventID);

		// stripping these would invalidate the signature, which covers the redacted form
		expect(captured.event).toHaveProperty('origin', 'hs1');
		expect(captured.event).toHaveProperty('membership', 'join');
		expect(captured.event).toHaveProperty('prev_state');

		expect(captured.event?.content).toEqual({ membership: 'join' });
	});

	it('drops the pre-v11 top level fields when redacting in a v11 room', async () => {
		const { service, captured } = buildService('11', memberEvent);

		// v11 moved the redaction target into content
		const redaction = {
			type: 'm.room.redaction',
			room_id: '!room:hs1',
			sender: '@alice:hs1',
			depth: 6,
			auth_events: [],
			prev_events: [],
			origin_server_ts: 1732999153020,
			content: { redacts: '$target' as EventID },
		} as unknown as PduForType<'m.room.redaction'>;

		await service.processRedaction(redaction);

		expect(captured.eventId).toBe('$target' as EventID);

		expect(captured.event).not.toHaveProperty('origin');
		expect(captured.event).not.toHaveProperty('membership');
		expect(captured.event).not.toHaveProperty('prev_state');

		expect(captured.event?.content).toEqual({ membership: 'join' });
	});

	it('records what redacted the event', async () => {
		const { service, captured } = buildService('11', memberEvent);

		const redaction = {
			type: 'm.room.redaction',
			room_id: '!room:hs1',
			sender: '@alice:hs1',
			depth: 6,
			auth_events: [],
			prev_events: [],
			origin_server_ts: 1732999153020,
			content: { redacts: '$target' as EventID },
		} as unknown as PduForType<'m.room.redaction'>;

		await service.processRedaction(redaction);

		expect(captured.event?.unsigned).toHaveProperty('redacted_because', redaction);
	});
});

describe('authorizeAndPersist', () => {
	const callMember = PersistentEventFactory.createFromRawEvent(
		{
			type: 'org.matrix.msc3401.call.member',
			state_key: '_@alice:hs2_DEVICE_m.call',
			content: {},
			room_id: '!room:hs1',
			sender: '@alice:hs2',
			depth: 6,
			auth_events: [],
			prev_events: [],
			origin_server_ts: 1732999153020,
		} as unknown as Pdu,
		'10',
	);

	function buildPersistingService(handlePdu: StateService['handlePdu']) {
		const notify = mock(async () => undefined);
		const markSticky = mock(async (): Promise<number | undefined> => undefined);

		const service = new EventService(
			null as never,
			null as never,
			{ handlePdu } as unknown as StateService,
			null as never,
			null as never,
			null as never,
			null as never,
			{ notify } as unknown as EventNotifierService,
			{ markSticky } as unknown as StickyEventService,
		);

		return { service, notify, markSticky };
	}

	it('notifies an event once it is persisted', async () => {
		const { service, notify } = buildPersistingService(async () => undefined);

		await service.authorizeAndPersist(callMember);

		expect(notify).toHaveBeenCalledWith(callMember, {});
	});

	it('notifies a sticky event with when its stickiness ends', async () => {
		const { service, notify, markSticky } = buildPersistingService(async () => undefined);
		markSticky.mockImplementationOnce(async () => 1733002754000);

		await service.authorizeAndPersist(callMember, 1732999154000);

		expect(notify).toHaveBeenCalledWith(callMember, { sticky: { expiresAt: 1733002754000 } });
	});

	it('records the stickiness of an event against when it was received', async () => {
		const { service, markSticky } = buildPersistingService(async () => undefined);

		await service.authorizeAndPersist(callMember, 1732999154000);

		expect(markSticky).toHaveBeenCalledWith(callMember, 1732999154000);
	});

	it('never makes sticky an event whose receive time is unknown', async () => {
		const { service, markSticky } = buildPersistingService(async () => undefined);

		await service.authorizeAndPersist(callMember);

		expect(markSticky).not.toHaveBeenCalled();
	});

	it('does not notify an event that was rejected', async () => {
		const { service, notify, markSticky } = buildPersistingService(async (event) => {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, { rejectedEvent: event, reason: 'insufficient power level' });
		});

		await expect(service.authorizeAndPersist(callMember, 1732999154000)).rejects.toThrow(StateResolverAuthorizationError);

		expect(notify).not.toHaveBeenCalled();
		expect(markSticky).not.toHaveBeenCalled();
	});
});
