import { describe, expect, it, spyOn } from 'bun:test';

import { encodeCanonicalJson } from '@rocket.chat/federation-crypto';
import type { EventID, Pdu, PduForType, RoomVersion } from '@rocket.chat/federation-room';

import { EventService } from './event.service';
import type { StateService } from './state.service';
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

	it.each([
		['missing', undefined],
		['not an array', '$prev1'],
	])('leaves prev_events that are %s to the schema', async (_, prevEvents) => {
		const { service, calls } = buildIncomingService();

		await service.processIncomingPDUs('hs2', [messageEvent({ prev_events: prevEvents })]);

		expect(calls.roomLookups).toBe(1);
		expect(calls.staged).toBe(0);
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
});
