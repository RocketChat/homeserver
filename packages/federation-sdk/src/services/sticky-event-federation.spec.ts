import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';

import type { EventRouterService } from '@rocket.chat/appservice';
import { type SigningKey, computeHash, generateKeyPairs, verifyJsonSignature } from '@rocket.chat/federation-core';
import { encodeCanonicalJson, toUnpaddedBase64 } from '@rocket.chat/federation-crypto';
import { type Pdu, type PersistentEventBase, PersistentEventFactory, type RoomID, type UserID } from '@rocket.chat/federation-room';

import type { ConfigService } from './config.service';
import { EventSenderService } from './event-sender.service';
import { EventService } from './event.service';
import type { FederationService } from './federation.service';
import type { ServerService } from './server.service';
import { StateService } from './state.service';
import type { StickyEventService } from './sticky-event.service';
import type { StagingAreaQueue } from '../queues/staging-area.queue';
import type { EventStagingRepository } from '../repositories/event-staging.repository';
import type { EventRepository } from '../repositories/event.repository';

const SERVER_NAME = 'hs1.example.com';
const ROOM_ID = `!room:${SERVER_NAME}` as RoomID;
const SENDER = `@alice:${SERVER_NAME}` as UserID;

// what a sticky MatrixRTC membership looks like when this server sends it and another one receives it
describe('sticky events over federation', () => {
	let signingKey: SigningKey;
	let nodeEnv: string | undefined;
	let sent: PersistentEventBase;

	beforeAll(async () => {
		signingKey = await generateKeyPairs(randomBytes(32));
		// signing is skipped under test, and the signatures are the point here
		nodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = 'development';
	});

	afterAll(() => {
		process.env.NODE_ENV = nodeEnv;
	});

	beforeEach(async () => {
		const configService = { serverName: SERVER_NAME, getSigningKey: async () => [signingKey] } as unknown as ConfigService;
		const signer = new StateService(null as never, null as never, configService);

		const stateService = {
			getRoomVersion: async () => '10',
			buildEvent: async (raw: Pdu) => {
				sent = await signer.signEvent(
					PersistentEventFactory.createFromRawEvent({ ...raw, auth_events: ['$create'], prev_events: ['$latest'], depth: 7 }, '10'),
				);
				return sent;
			},
			handlePdu: async () => undefined,
		} as unknown as StateService;

		const sender = new EventSenderService(
			stateService,
			{ sendEventToAllServersInRoom: async () => undefined } as unknown as FederationService,
			{ routePersistent: async () => undefined } as unknown as EventRouterService,
			{ markSticky: async () => undefined } as unknown as StickyEventService,
		);

		const { eventId } = await sender.sendStickyEvent(
			ROOM_ID,
			'org.matrix.msc4143.rtc.member',
			{ slot_id: 'm.call#ROOM', msc4354_sticky_key: 'member-1' },
			SENDER,
			3_600_000,
		);

		expect(sent.eventId).toBe(eventId);
	});

	// the received copy as a remote server gets it in a transaction
	const onTheWire = () => JSON.parse(JSON.stringify(sent.event)) as Pdu & { msc4354_sticky?: unknown };

	test('hashes the content including msc4354_sticky', () => {
		const wire = onTheWire();
		const { msc4354_sticky: _sticky, ...withoutSticky } = wire;

		expect(wire.msc4354_sticky).toEqual({ duration_ms: 3_600_000 });
		expect(wire.hashes.sha256).toBe(computeHash(wire)[1]);
		expect(wire.hashes.sha256).not.toBe(computeHash(withoutSticky)[1]);
	});

	test('computes the event id and the signature over the redacted form, which has no msc4354_sticky', () => {
		const wire = onTheWire();
		const { redactedEvent } = sent;

		expect(redactedEvent).not.toHaveProperty('msc4354_sticky');
		expect(redactedEvent.hashes).toEqual(wire.hashes);

		const { signatures: _signatures, unsigned: _unsigned, ...referenced } = redactedEvent as Record<string, unknown>;
		const referenceHash = createHash('sha256').update(encodeCanonicalJson(referenced)).digest();
		expect(sent.eventId).toBe(`$${toUnpaddedBase64(referenceHash, { urlSafe: true })}`);

		const [keyId] = Object.keys(wire.signatures[SERVER_NAME]);
		const signature = Uint8Array.from(Buffer.from(wire.signatures[SERVER_NAME][keyId], 'base64'));
		expect(verifyJsonSignature(redactedEvent, SERVER_NAME, signature, signingKey.publicKey, signingKey.algorithm, signingKey.version)).toBe(
			true,
		);
	});

	describe('a receiving server', () => {
		let stage: ReturnType<typeof mock>;
		let receiver: EventService;

		beforeEach(() => {
			stage = mock(async () => undefined);

			receiver = new EventService(
				{ serverName: 'hs2.example.com' } as unknown as ConfigService,
				{ enqueue: () => undefined } as unknown as StagingAreaQueue,
				{ getRoomVersion: async () => '10' } as unknown as StateService,
				{ getPublicKey: async () => Buffer.from(signingKey.publicKey).toString('base64') } as unknown as ServerService,
				null as never,
				{ findById: async () => null } as unknown as EventRepository,
				{ create: stage } as unknown as EventStagingRepository,
				null as never,
				null as never,
			);
		});

		test('accepts the event with msc4354_sticky intact under the same event id', async () => {
			const wire = onTheWire();

			await receiver.processIncomingPDUs(SERVER_NAME, [wire]);

			expect(stage).toHaveBeenCalledTimes(1);
			const [eventId, origin, staged] = stage.mock.calls[0];
			expect(eventId).toBe(sent.eventId);
			expect(origin).toBe(SERVER_NAME);
			expect(staged).toEqual(wire);
		});

		test('drops a copy whose msc4354_sticky was tampered with', async () => {
			const wire = { ...onTheWire(), msc4354_sticky: { duration_ms: 60_000 } };

			await receiver.processIncomingPDUs(SERVER_NAME, [wire]);

			expect(stage).not.toHaveBeenCalled();
		});
	});
});
