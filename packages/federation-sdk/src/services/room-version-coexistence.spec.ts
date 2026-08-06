import { beforeEach, describe, expect, it } from 'bun:test';

import { type EventStore } from '@rocket.chat/federation-core';
import type { EventID, Pdu, PduCreateEventContent, RoomVersion, UserID } from '@rocket.chat/federation-room';
import { PersistentEventFactory } from '@rocket.chat/federation-room';
import { type WithId } from 'mongodb';

import { type ConfigService } from './config.service';
import { DatabaseConnectionService } from './database-connection.service';
import { EventFetcherService } from './event-fetcher.service';
import type { EventService } from './event.service';
import type { FederationService } from './federation.service';
import { StateService } from './state.service';
import { EventRepository } from '../repositories/event.repository';
import { StateGraphRepository } from '../repositories/state-graph.repository';
import type { StateGraphStore } from '../repositories/state-graph.repository';

// A v10 room created before v11 became the default has to keep working alongside new
// v11 rooms, in the same database and process. Every assertion here is run against both
// versions so a version specific regression cannot pass unnoticed.
describe('room version coexistence', async () => {
	if (!process.env.RUN_MONGO_TESTS) {
		console.warn('Skipping tests that require a database');
		return;
	}

	const alice = '@alice:example.com' as UserID;
	const bob = '@bob:example.com' as UserID;

	const database = new DatabaseConnectionService({
		uri: process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true',
		name: 'matrix_test',
		poolSize: 100,
	});

	const eventCollection = (await database.getDb()).collection<WithId<EventStore>>('events_coexistence_test');
	const stateGraphCollection = (await database.getDb()).collection<StateGraphStore>('state_graph_coexistence_test');

	beforeEach(async () => {
		await Promise.all([eventCollection.deleteMany({}), stateGraphCollection.deleteMany({})]);
	});

	const stateService = new StateService(
		new StateGraphRepository(stateGraphCollection),
		new EventRepository(eventCollection),
		{ getSigningKey: async () => undefined, serverName: 'example.com' } as unknown as ConfigService,
		{ notify: () => Promise.resolve() } as unknown as EventService,
	);

	const defaults = () => ({ auth_events: [], prev_events: [], origin_server_ts: Date.now(), depth: 0 });

	async function createRoom(roomVersion: RoomVersion) {
		const createEvent = PersistentEventFactory.newCreateEvent(alice, roomVersion);
		await stateService.handlePdu(createEvent);

		const { roomId } = createEvent;

		const join = await stateService.buildEvent<'m.room.member'>(
			{ type: 'm.room.member', room_id: roomId, sender: alice, state_key: alice, content: { membership: 'join' }, ...defaults() },
			roomVersion,
		);
		await stateService.handlePdu(join);

		const powerLevels = await stateService.buildEvent<'m.room.power_levels'>(
			{
				type: 'm.room.power_levels',
				room_id: roomId,
				sender: alice,
				state_key: '',
				content: {
					users: { [alice]: 100 },
					users_default: 0,
					events: {},
					events_default: 0,
					state_default: 50,
					ban: 50,
					kick: 50,
					redact: 50,
					invite: 50,
				},
				...defaults(),
			},
			roomVersion,
		);
		await stateService.handlePdu(powerLevels);

		const joinRules = await stateService.buildEvent<'m.room.join_rules'>(
			{ type: 'm.room.join_rules', room_id: roomId, sender: alice, state_key: '', content: { join_rule: 'public' }, ...defaults() },
			roomVersion,
		);
		await stateService.handlePdu(joinRules);

		return { createEvent, roomId, join, powerLevels, joinRules };
	}

	async function sendMessage(roomId: ReturnType<typeof String> & string, roomVersion: RoomVersion, body: string) {
		const message = await stateService.buildEvent<'m.room.message'>(
			// @ts-expect-error room id is branded, the harness passes it through
			{ type: 'm.room.message', room_id: roomId, sender: alice, content: { msgtype: 'm.text', body }, ...defaults() },
			roomVersion,
		);
		await stateService.handlePdu(message);
		return message;
	}

	it('creates each room at its own version and resolves the creator on both', async () => {
		const v10 = await createRoom('10');
		const v11 = await createRoom('11');

		expect(await stateService.getRoomVersion(v10.roomId)).toBe('10');
		expect(await stateService.getRoomVersion(v11.roomId)).toBe('11');

		// the wire format differs, the accessor does not
		expect(v10.createEvent.getContent<PduCreateEventContent>().creator).toBe(alice);
		expect(v11.createEvent.getContent<PduCreateEventContent>().creator).toBeUndefined();
		expect(v10.createEvent.getCreator()).toBe(alice);
		expect(v11.createEvent.getCreator()).toBe(alice);

		// and the same holds through the service seam, so consumers never touch content.creator
		expect((await stateService.getCreateEvent(v10.roomId)).getCreator()).toBe(alice);
		expect((await stateService.getCreateEvent(v11.roomId)).getCreator()).toBe(alice);
	});

	it('keeps v10 and v11 rooms independent while both are used', async () => {
		const v10 = await createRoom('10');
		const v11 = await createRoom('11');

		// interleave the two rooms rather than finishing one first
		const joinV10 = await stateService.buildEvent<'m.room.member'>(
			{ type: 'm.room.member', room_id: v10.roomId, sender: bob, state_key: bob, content: { membership: 'join' }, ...defaults() },
			'10',
		);
		await stateService.handlePdu(joinV10);

		const joinV11 = await stateService.buildEvent<'m.room.member'>(
			{ type: 'm.room.member', room_id: v11.roomId, sender: bob, state_key: bob, content: { membership: 'join' }, ...defaults() },
			'11',
		);
		await stateService.handlePdu(joinV11);

		const messageV10 = await sendMessage(v10.roomId, '10', 'hello from the v10 room');
		const messageV11 = await sendMessage(v11.roomId, '11', 'hello from the v11 room');

		expect(joinV10.rejected).toBeFalse();
		expect(joinV11.rejected).toBeFalse();
		expect(messageV10.rejected).toBeFalse();
		expect(messageV11.rejected).toBeFalse();

		const stateV10 = await stateService.getLatestRoomState2(v10.roomId);
		const stateV11 = await stateService.getLatestRoomState2(v11.roomId);

		expect(stateV10.isUserInRoom(bob)).toBeTrue();
		expect(stateV11.isUserInRoom(bob)).toBeTrue();
		expect(stateV10.creator).toBe(alice);
		expect(stateV11.creator).toBe(alice);

		// no cross talk: each room only knows its own events
		const v10Ids = new Set([...(await stateService.getLatestRoomState(v10.roomId)).values()].map((e) => e.eventId));
		const v11Ids = new Set([...(await stateService.getLatestRoomState(v11.roomId)).values()].map((e) => e.eventId));
		expect([...v10Ids].some((id) => v11Ids.has(id))).toBeFalse();
	});

	async function expectRedactionRoundTrip(roomVersion: RoomVersion) {
		const { roomId } = await createRoom(roomVersion);
		const message = await sendMessage(roomId, roomVersion, 'redact me');

		const redaction = await stateService.buildEvent<'m.room.redaction'>(
			{
				type: 'm.room.redaction',
				// @ts-expect-error room id is branded, the harness passes it through
				room_id: roomId,
				sender: alice,
				...PersistentEventFactory.newRedactionEventFields(message.eventId, { reason: 'spam' }, roomVersion),
				...defaults(),
			},
			roomVersion,
		);
		await stateService.handlePdu(redaction);

		expect(redaction.rejected).toBeFalse();

		// the target is readable back, and survives redaction, which is what B4 was about
		expect(redaction.getRedacts()).toBe(message.eventId);
		expect(PersistentEventFactory.createFromRawEvent(redaction.event, roomVersion).getRedacts()).toBe(message.eventId);

		return redaction.event as typeof redaction.event & { redacts?: EventID };
	}

	it('redacts in a v10 room with the target at the top level', async () => {
		const wire = await expectRedactionRoundTrip('10');

		expect(wire.redacts).toBeDefined();
		expect(wire.content).not.toHaveProperty('redacts');
	});

	it('redacts in a v11 room with the target in content', async () => {
		const wire = await expectRedactionRoundTrip('11');

		expect(wire.redacts).toBeUndefined();
		expect(wire.content).toHaveProperty('redacts');
	});

	async function expectBanWorks(roomVersion: RoomVersion) {
		const { roomId } = await createRoom(roomVersion);

		const join = await stateService.buildEvent<'m.room.member'>(
			// @ts-expect-error room id is branded, the harness passes it through
			{ type: 'm.room.member', room_id: roomId, sender: bob, state_key: bob, content: { membership: 'join' }, ...defaults() },
			roomVersion,
		);
		await stateService.handlePdu(join);

		const ban = await stateService.buildEvent<'m.room.member'>(
			// @ts-expect-error room id is branded, the harness passes it through
			{ type: 'm.room.member', room_id: roomId, sender: alice, state_key: bob, content: { membership: 'ban' }, ...defaults() },
			roomVersion,
		);
		await stateService.handlePdu(ban);

		expect(ban.rejected).toBeFalse();
		// @ts-expect-error room id is branded, the harness passes it through
		expect((await stateService.getLatestRoomState2(roomId)).getUserMembership(bob)).toBe('ban');
	}

	it('bans in a v10 room', async () => expectBanWorks('10'));

	it('bans in a v11 room', async () => expectBanWorks('11'));

	// the fetcher used to resolve the version with its own read that fell back to
	// defaultRoomVersion, so a v10 room's federated events got v10-invalid ids
	it('identifies federation-fetched events at the room version, not the default', async () => {
		const { roomId } = await createRoom('10');

		// origin is a top level field v10 keeps under redaction and v11 drops, so the
		// two versions disagree on this event's id
		const fetched = {
			type: 'm.room.message',
			room_id: roomId,
			sender: bob,
			content: { msgtype: 'm.text', body: 'from federation' },
			origin: 'example.com',
			...defaults(),
		} as unknown as Pdu;

		const atRoomVersion = PersistentEventFactory.createFromRawEvent(fetched, '10').eventId;
		const atDefaultVersion = PersistentEventFactory.createFromRawEvent(fetched, PersistentEventFactory.defaultRoomVersion).eventId;
		expect(atRoomVersion).not.toBe(atDefaultVersion);

		const fetcher = new EventFetcherService(
			new EventRepository(eventCollection),
			{ getEvent: async () => ({ pdus: [fetched] }) } as unknown as FederationService,
			{ serverName: 'example.com' } as unknown as ConfigService,
			stateService,
		);

		const { events } = await fetcher.fetchEventsByIds([atRoomVersion], roomId, 'remote.example.com');

		expect(events).toHaveLength(1);
		expect(events[0].eventId).toBe(atRoomVersion);
	});
});
