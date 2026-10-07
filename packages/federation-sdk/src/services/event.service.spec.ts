import { describe, expect, it, mock, spyOn } from 'bun:test';

import { generateKeyPairs, signEvent } from '@rocket.chat/federation-core';
import { encodeCanonicalJson } from '@rocket.chat/federation-crypto';
import { PersistentEventBase, PersistentEventFactory, RejectCodes, StateResolverAuthorizationError } from '@rocket.chat/federation-room';
import type { EventID, Pdu, PduForType, RoomID, RoomVersion, UserID } from '@rocket.chat/federation-room';

import type { EventNotifierService } from './event-notifier.service';
import { EventService } from './event.service';
import type { ServerService } from './server.service';
import type { StateService } from './state.service';
import type { StickyEventService } from './sticky-event.service';
import type { StagingAreaQueue } from '../queues/staging-area.queue';
import type { EventStagingRepository } from '../repositories/event-staging.repository';
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

describe('processIncomingPDUs', () => {
	function buildIncomingService() {
		const calls = { roomLookups: 0, staged: 0 };

		const stateService = {
			async getRoomVersion() {
				calls.roomLookups++;
				return '11';
			},
		} as unknown as StateService;

		const serverService = {
			async getPublicKey() {
				throw new Error('no keys in this test');
			},
		};

		const service = new EventService(
			null as never,
			{ enqueue: () => undefined } as never,
			stateService,
			serverService as never,
			{ emit: async () => undefined } as never,
			{ findById: async () => null } as never,
			{
				async create() {
					calls.staged++;
				},
			} as never,
			null as never,
		);

		const { logger } = service as unknown as { logger: { error: (entry: unknown) => void } };
		const logError = spyOn(logger, 'error').mockImplementation(() => undefined);
		const errorLog = (msg: string) =>
			logError.mock.calls.map(([entry]) => entry as unknown as Record<string, unknown>).find((entry) => entry.msg === msg);

		return { service, calls, errorLog, errorLogCount: () => logError.mock.calls.length };
	}

	const messageEvent = (overrides: Record<string, unknown>) =>
		({
			type: 'm.room.message',
			room_id: '!room:hs1',
			sender: '@mallory:hs2',
			origin_server_ts: 1732999153019,
			depth: 10,
			content: { msgtype: 'm.text', body: 'hi' },
			auth_events: ['$auth1'],
			prev_events: ['$prev1'],
			hashes: { sha256: 'hash' },
			signatures: { hs2: { 'ed25519:key': 'sig' } },
			...overrides,
		} as unknown as Pdu);

	it.each([
		['more than 20 prev_events', { prev_events: Array.from({ length: 21 }, (_, i) => `$prev${i}`) }],
		['more than 10 auth_events', { auth_events: Array.from({ length: 11 }, (_, i) => `$auth${i}`) }],
		['more than 64 KiB', { content: { msgtype: 'm.text', body: 'x'.repeat(65536) } }],
		// every item fails the schema, which used to cost kilobytes of heap per item
		['a huge prev_events array of invalid items', { prev_events: new Array(1_000_000).fill(0) }],
	])('rejects a PDU with %s before validating it against the room', async (_, overrides) => {
		const { service, calls } = buildIncomingService();

		await service.processIncomingPDUs('hs2', [messageEvent(overrides)]);

		expect(calls.roomLookups).toBe(0);
		expect(calls.staged).toBe(0);
	});

	it('validates a PDU at the limits against the room', async () => {
		const { service, calls } = buildIncomingService();

		await service.processIncomingPDUs('hs2', [
			messageEvent({
				prev_events: Array.from({ length: 20 }, (_, i) => `$prev${i}`),
				auth_events: Array.from({ length: 10 }, (_, i) => `$auth${i}`),
			}),
		]);

		expect(calls.roomLookups).toBe(1);
	});

	it.each([
		['accepts', 65536, 1],
		['rejects', 65537, 0],
	])('%s a PDU of %i bytes', async (_, size, roomLookups) => {
		const { service, calls } = buildIncomingService();

		const unpadded = messageEvent({ content: { msgtype: 'm.text', body: '' } });
		const padding = size - Buffer.byteLength(encodeCanonicalJson(unpadded));
		const event = messageEvent({ content: { msgtype: 'm.text', body: 'x'.repeat(padding) } });
		expect(Buffer.byteLength(encodeCanonicalJson(event))).toBe(size);

		await service.processIncomingPDUs('hs2', [event]);

		expect(calls.roomLookups).toBe(roomLookups);
	});

	it('does not measure the size of a PDU already over the count limits', async () => {
		const withReadCounter = (event: Pdu) => {
			const counter = { reads: 0 };
			Object.defineProperty(event, 'content', {
				enumerable: true,
				get: () => {
					counter.reads++;
					return { msgtype: 'm.text', body: 'hi' };
				},
			});
			return { event, counter };
		};

		const overLimit = withReadCounter(messageEvent({ prev_events: Array.from({ length: 21 }, (_, i) => `$prev${i}`) }));
		const withinLimit = withReadCounter(messageEvent({}));

		await buildIncomingService().service.processIncomingPDUs('hs2', [overLimit.event]);
		await buildIncomingService().service.processIncomingPDUs('hs2', [withinLimit.event]);

		expect(overLimit.counter.reads).toBe(0);
		expect(withinLimit.counter.reads).toBeGreaterThan(0);
	});

	it('leaves prev_events that are not an array to the schema', async () => {
		const { service, calls } = buildIncomingService();

		await service.processIncomingPDUs('hs2', [messageEvent({ prev_events: '$prev1' })]);

		expect(calls.roomLookups).toBe(1);
		expect(calls.staged).toBe(0);
	});

	it.each([
		['prev_events', 'Event must reference previous events (prev_events)'],
		['auth_events', 'Event must list its auth_events'],
	])('rejects a PDU missing %s as an invalid event', async (field, error) => {
		const { service, calls, errorLog } = buildIncomingService();

		await service.processIncomingPDUs('hs2', [messageEvent({ [field]: undefined })]);

		expect(calls.staged).toBe(0);
		expect(errorLog('Create event validation failed')?.errors).toEqual([error]);
		expect((errorLog('Event validation failed')?.err as Error).message).toBe('M_INVALID_EVENT');
	});

	it('logs at most 10 schema issues, with their total', async () => {
		const { service, errorLog } = buildIncomingService();

		await service.processIncomingPDUs('hs2', [messageEvent({ prev_events: new Array(20).fill(0), auth_events: new Array(10).fill(0) })]);

		const log = errorLog('Event failed schema validation');
		expect(log?.issueCount).toBe(30);
		expect(log?.issues).toHaveLength(10);
		for (const issue of log?.issues as unknown[]) {
			expect(issue).toEqual({
				code: expect.any(String),
				path: expect.stringMatching(/^(prev|auth)_events\.\d+$/),
				message: expect.any(String),
			});
		}
	});

	it('logs a PDU rejected for its bounds once, with the reason', async () => {
		const { service, errorLog, errorLogCount } = buildIncomingService();

		await service.processIncomingPDUs('hs2', [messageEvent({ prev_events: Array.from({ length: 21 }, (_, i) => `$prev${i}`) })]);

		expect(errorLogCount()).toBe(1);
		expect((errorLog('Event validation failed')?.err as Error).message).toBe(
			'M_INVALID_EVENT: Event must not have more than 20 prev_events',
		);
	});

	it('logs a rejected PDU by its type, room and sender only', async () => {
		const { service, errorLog } = buildIncomingService();

		await service.processIncomingPDUs('hs2', [messageEvent({ content: { msgtype: 'm.text', body: 'x'.repeat(65536) } })]);

		expect(errorLog('Event validation failed')?.event).toEqual({ type: 'm.room.message', room_id: '!room:hs1', sender: '@mallory:hs2' });
	});

	it('cuts long fields and names non-string fields by their type when logging a rejected PDU', async () => {
		const { service, errorLog } = buildIncomingService();

		await service.processIncomingPDUs('hs2', [
			messageEvent({ type: 't'.repeat(1000), room_id: 42, prev_events: Array.from({ length: 21 }, (_, i) => `$prev${i}`) }),
		]);

		expect(errorLog('Event validation failed')?.event).toEqual({ type: 't'.repeat(255), room_id: 'number', sender: '@mallory:hs2' });
	});

	it('drops a PDU without room_id and still processes the rest of the transaction', async () => {
		const origin = 'remote.com';
		const key = await generateKeyPairs(new Uint8Array(32).fill(3));
		const keyId = `${key.algorithm}:${key.version}`;

		const sign = async (event: PersistentEventBase) => {
			const signed = await signEvent(event.redactedEvent as Pdu, key, origin, false);
			event.addSignature(origin, keyId, signed.signatures[origin][keyId]);
			return event.event as Pdu;
		};

		const create = PersistentEventFactory.newCreateEvent('@alice:remote.com' as UserID, '12');
		const message = PersistentEventFactory.createFromRawEvent(
			{
				type: 'm.room.message',
				sender: '@alice:remote.com' as UserID,
				room_id: create.roomId,
				content: { msgtype: 'm.text', body: 'hello' },
				origin_server_ts: 2,
				depth: 2,
				prev_events: [create.eventId],
				auth_events: [] as EventID[],
			},
			'12',
		);

		const staged: EventID[] = [];
		const enqueued: RoomID[] = [];

		const service = new EventService(
			null as never,
			{ enqueue: (roomId: RoomID) => enqueued.push(roomId) } as unknown as StagingAreaQueue,
			{ getRoomVersion: async () => '12' } as unknown as StateService,
			{ getPublicKey: async () => Buffer.from(key.publicKey).toString('base64') } as unknown as ServerService,
			null as never,
			{ findById: async () => null } as unknown as EventRepository,
			{ create: async (eventId: EventID) => staged.push(eventId) } as unknown as EventStagingRepository,
			null as never,
			null as never,
		);

		await service.processIncomingPDUs(origin, [await sign(create), await sign(message)]);

		expect(staged).toEqual([message.eventId]);
		expect(enqueued).toEqual([create.roomId]);
	});

	// hashed over the raw lists but signed over the de-duplicated form, so only the duplicate check can reject it
	it.each([
		['stages a PDU listing distinct prev and auth events', false, false, true],
		['drops a PDU listing the same prev event twice', true, false, false],
		['drops a PDU listing the same auth event twice', false, true, false],
	])('%s', async (_, duplicatePrev, duplicateAuth, expectStaged) => {
		const origin = 'remote.com';
		const key = await generateKeyPairs(new Uint8Array(32).fill(3));

		const create = PersistentEventFactory.newCreateEvent('@alice:remote.com' as UserID, '12');
		const member = PersistentEventFactory.newCreateEvent('@bob:remote.com' as UserID, '12');
		const raw = {
			type: 'm.room.message',
			sender: '@alice:remote.com',
			room_id: create.roomId,
			content: { msgtype: 'm.text', body: 'hello' },
			origin_server_ts: 2,
			depth: 2,
			prev_events: duplicatePrev ? [create.eventId, create.eventId] : [create.eventId],
			auth_events: duplicateAuth ? [member.eventId, member.eventId] : [member.eventId],
		} as unknown as Pdu;
		const hashed = { ...raw, hashes: { sha256: PersistentEventBase.getContentHashString(raw) } } as Pdu;
		const { redactedEvent } = PersistentEventFactory.createFromRawEvent(hashed, '12');
		const { signatures } = await signEvent(redactedEvent as Pdu, key, origin, false);

		const staged: EventID[] = [];

		const service = new EventService(
			null as never,
			{ enqueue: () => undefined } as unknown as StagingAreaQueue,
			{ getRoomVersion: async () => '12' } as unknown as StateService,
			{ getPublicKey: async () => Buffer.from(key.publicKey).toString('base64') } as unknown as ServerService,
			null as never,
			{ findById: async () => null } as unknown as EventRepository,
			{ create: async (eventId: EventID) => staged.push(eventId) } as unknown as EventStagingRepository,
			null as never,
			null as never,
		);

		await service.processIncomingPDUs(origin, [{ ...hashed, signatures } as Pdu]);

		expect(staged).toHaveLength(expectStaged ? 1 : 0);
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
