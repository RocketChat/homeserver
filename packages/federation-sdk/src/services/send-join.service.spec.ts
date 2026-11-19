import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { type EventStore } from '@rocket.chat/federation-core';
import { PersistentEventFactory } from '@rocket.chat/federation-room';
import type { EventID, PduForType, RoomVersion, UserID } from '@rocket.chat/federation-room';
import { type WithId } from 'mongodb';

import { type ConfigService } from './config.service';
import { DatabaseConnectionService } from './database-connection.service';
import { type EventEmitterService } from './event-emitter.service';
import type { EventService } from './event.service';
import type { FederationService } from './federation.service';
import { SendJoinService } from './send-join.service';
import { StateService } from './state.service';
import { EventRepository } from '../repositories/event.repository';
import { StateGraphRepository } from '../repositories/state-graph.repository';
import type { StateGraphStore } from '../repositories/state-graph.repository';

describe('SendJoinService', async () => {
	if (!process.env.RUN_MONGO_TESTS) {
		console.warn('Skipping tests that require a database');
		return;
	}

	const alice = '@alice:example.com' as UserID;
	const bob = '@bob:remote.com' as UserID;

	const database = new DatabaseConnectionService({
		uri: process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true',
		name: 'matrix_test',
		poolSize: 100,
	});

	const eventCollection = (await database.getDb()).collection<WithId<EventStore>>('events_send_join_test');
	const stateGraphCollection = (await database.getDb()).collection<StateGraphStore>('state_graph_send_join_test');

	beforeEach(async () => {
		await Promise.all([eventCollection.deleteMany({}), stateGraphCollection.deleteMany({})]);
	});

	afterAll(async () => {
		await database.disconnect();
	});

	const eventRepository = new EventRepository(eventCollection);
	const configService = { getSigningKey: async () => undefined, serverName: 'example.com' } as unknown as ConfigService;

	const stateService = new StateService(new StateGraphRepository(stateGraphCollection), eventRepository, configService, {
		notify: () => Promise.resolve(),
	} as unknown as EventService);

	const sendJoinService = new SendJoinService(
		{ getEventsByIds: (ids: EventID[]) => eventRepository.findByIds(ids).toArray() } as unknown as EventService,
		{ emit: () => Promise.resolve() } as unknown as EventEmitterService,
		stateService,
		configService,
		{ sendEventToAllServersInRoom: () => Promise.resolve() } as unknown as FederationService,
	);

	const defaults = () => ({ auth_events: [], prev_events: [], origin_server_ts: Date.now(), depth: 0 });

	async function createRoom(roomVersion: RoomVersion) {
		const createEvent = PersistentEventFactory.newCreateEvent(alice, roomVersion);
		await stateService.handlePdu(createEvent);
		const { roomId } = createEvent;

		const { privilegedCreators } = PersistentEventFactory.getCapabilities(roomVersion);

		for (const event of [
			{ type: 'm.room.member', state_key: alice, content: { membership: 'join' } },
			{ type: 'm.room.power_levels', state_key: '', content: { users: privilegedCreators ? {} : { [alice]: 100 }, users_default: 0 } },
			{ type: 'm.room.join_rules', state_key: '', content: { join_rule: 'public' } },
		] as const) {
			// eslint-disable-next-line no-await-in-loop
			const built = await stateService.buildEvent({ ...event, room_id: roomId, sender: alice, ...defaults() } as never, roomVersion);
			// eslint-disable-next-line no-await-in-loop
			await stateService.handlePdu(built);
		}

		return { createEvent, roomId };
	}

	async function sendJoin(roomVersion: RoomVersion) {
		const { createEvent, roomId } = await createRoom(roomVersion);

		const join = await stateService.buildEvent<'m.room.member'>(
			{ type: 'm.room.member', room_id: roomId, sender: bob, state_key: bob, content: { membership: 'join' }, ...defaults() },
			roomVersion,
		);

		const response = await sendJoinService.sendJoin(roomId, join.eventId, join.event as PduForType<'m.room.member'>);

		return { createEvent, response };
	}

	it('includes the create event in the auth chain of a v12 room, which no auth_events reference', async () => {
		const { createEvent, response } = await sendJoin('12');

		const authChainIds = response.auth_chain.map((pdu) => PersistentEventFactory.createFromRawEvent(pdu, '12').eventId);

		expect(authChainIds).toContain(createEvent.eventId);
		expect(new Set(authChainIds).size).toBe(authChainIds.length);
		expect(response.state.some((pdu) => pdu.type === 'm.room.create')).toBeTrue();
	});

	it('still includes the create event in the auth chain of a v11 room', async () => {
		const { createEvent, response } = await sendJoin('11');

		const authChainIds = response.auth_chain.map((pdu) => PersistentEventFactory.createFromRawEvent(pdu, '11').eventId);

		expect(authChainIds).toContain(createEvent.eventId);
	});
});
