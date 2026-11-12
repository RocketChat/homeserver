import { describe, expect, it } from 'bun:test';

import { generateKeyPairs, signEvent } from '@rocket.chat/federation-core';
import { PersistentEventFactory } from '@rocket.chat/federation-room';
import type { EventID, Pdu, PduForType, PersistentEventBase, RoomID, RoomVersion, UserID } from '@rocket.chat/federation-room';

import { EventService } from './event.service';
import type { ServerService } from './server.service';
import type { StateService } from './state.service';
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
		);

		await service.processIncomingPDUs(origin, [await sign(create), await sign(message)]);

		expect(staged).toEqual([message.eventId]);
		expect(enqueued).toEqual([create.roomId]);
	});
});
