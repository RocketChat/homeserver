import { describe, expect, it, test } from 'bun:test';
import { type ConfigService } from './config.service';
import { DatabaseConnectionService } from './database-connection.service';
import { StateRepository, StateStore } from '../repositories/state.repository';
import { EventRepository } from '../repositories/event.repository';
import { type WithId } from 'mongodb';
import { type EventStore } from '@hs/core';
import { StateService } from './state.service';
import {
	PduCreate,
	PduCreateEventContent,
	PersistentEventFactory,
} from '@hs/room';

describe('StateService', async () => {
	if (process.env.NODE_ENV !== 'test') {
		console.warn('Skipping tests that require a database');
		return;
	}

	const configServiceInstance = {
		getSigningKey: async () => {},
		serverName: 'example.com',
		database: {
			uri: 'mongodb://localhost:27017',
			name: 'federation',
			poolSize: 100,
		},
		getDatabaseConfig: function () {
			return this.database;
		},
	} as unknown as ConfigService;

	const database = new DatabaseConnectionService(configServiceInstance);

	const stateCollection = (await database.getDb()).collection<
		WithId<StateStore>
	>('state');
	const eventCollection = (await database.getDb()).collection<
		WithId<EventStore>
	>('events');

	const stateRepository = new StateRepository(stateCollection);
	const eventRepository = new EventRepository(eventCollection);

	const stateService = new StateService(
		stateRepository,
		eventRepository,
		configServiceInstance,
	);

	const createRoom = async (joinRule) => {
		const username = '@alice:example.com';
		const name = 'Test Room';

		const roomCreateEvent = PersistentEventFactory.newCreateEvent(
			username,
			PersistentEventFactory.defaultRoomVersion,
		);
		await stateService.persistStateEvent(roomCreateEvent);

		const creatorMembershipEvent = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			username,
			username,
			'join',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(creatorMembershipEvent),
			stateService.addPrevEvents(creatorMembershipEvent),
		]);

		await stateService.persistStateEvent(creatorMembershipEvent);

		const roomNameEvent = PersistentEventFactory.newRoomNameEvent(
			roomCreateEvent.roomId,
			username,
			name,
			PersistentEventFactory.defaultRoomVersion,
		);

		await Promise.all([
			stateService.addAuthEvents(roomNameEvent),
			stateService.addPrevEvents(roomNameEvent),
		]);

		await stateService.persistStateEvent(roomNameEvent);

		const powerLevelEvent = PersistentEventFactory.newPowerLevelEvent(
			roomCreateEvent.roomId,
			username,
			{
				users: {
					[username]: 100,
				},
				users_default: 0,
				events: {},
				events_default: 0,
				state_default: 50,
				ban: 50,
				kick: 50,
				redact: 50,
				invite: 50,
			},
			PersistentEventFactory.defaultRoomVersion,
		);

		await Promise.all([
			stateService.addAuthEvents(powerLevelEvent),
			stateService.addPrevEvents(powerLevelEvent),
		]);

		await stateService.persistStateEvent(powerLevelEvent);

		const joinRuleEvent = PersistentEventFactory.newJoinRuleEvent(
			roomCreateEvent.roomId,
			username,
			joinRule,
			PersistentEventFactory.defaultRoomVersion,
		);

		await Promise.all([
			stateService.addAuthEvents(joinRuleEvent),
			stateService.addPrevEvents(joinRuleEvent),
		]);

		await stateService.persistStateEvent(joinRuleEvent);

		const canonicalAliasEvent = PersistentEventFactory.newCanonicalAliasEvent(
			roomCreateEvent.roomId,
			username,
			`#${name}:${configServiceInstance.serverName}`,
			PersistentEventFactory.defaultRoomVersion,
		);

		await Promise.all([
			stateService.addAuthEvents(canonicalAliasEvent),
			stateService.addPrevEvents(canonicalAliasEvent),
		]);

		await stateService.persistStateEvent(canonicalAliasEvent);

		return roomCreateEvent;
	};

	it('should create a room successfully', async () => {
		const { roomId } = await createRoom('public');
		expect(roomId).toBeDefined();
		return expect(
			stateService.getFullRoomState2(roomId),
		).resolves.toBeDefined();
	});

	it('should successfully have a user join the room', async () => {
		const roomCreateEvent = await createRoom('public');
		const newUser = '@bob:example.com';
		const membershipEvent = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			newUser,
			newUser,
			'join',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEvent),
			stateService.addPrevEvents(membershipEvent),
		]);

		await stateService.persistStateEvent(membershipEvent);

		const state = await stateService.getFullRoomState2(roomCreateEvent.roomId);
		expect(state.isUserInRoom(newUser)).toBe(true);
	});

	it('should have a user leave the room successfully', async () => {
		const roomCreateEvent = await createRoom('public');
		const newUser = '@bob:example.com';
		const membershipEventJoin = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			newUser,
			newUser,
			'join',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEventJoin),
			stateService.addPrevEvents(membershipEventJoin),
		]);

		await stateService.persistStateEvent(membershipEventJoin);

		const membershipEventLeave = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			newUser,
			newUser,
			'leave',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEventLeave),
			stateService.addPrevEvents(membershipEventLeave),
		]);

		await stateService.persistStateEvent(membershipEventLeave);

		const state = await stateService.getFullRoomState2(roomCreateEvent.roomId);
		expect(state.isUserInRoom(newUser)).toBe(false);
	});

	it('should not allow joining if room is invite only', async () => {
		const roomCreateEvent = await createRoom('invite');
		const newUser = '@bob:example.com';
		const membershipEvent = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			newUser,
			newUser,
			'join',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEvent),
			stateService.addPrevEvents(membershipEvent),
		]);

		await expect(
			stateService.persistStateEvent(membershipEvent),
		).rejects.toThrowError();
	});

	it('should allow joining if invited in invite only room', async () => {
		const roomCreateEvent = await createRoom('invite');
		const newUser = '@bob:example.com';
		const membershipEventInvite = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
			newUser,
			'invite',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEventInvite),
			stateService.addPrevEvents(membershipEventInvite),
		]);

		await stateService.persistStateEvent(membershipEventInvite);

		expect(
			(
				await stateService.getFullRoomState2(roomCreateEvent.roomId)
			).isUserInvited(newUser),
		).toBeTrue();

		const membershipEventJoin = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			newUser,
			newUser,
			'join',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEventJoin),
			stateService.addPrevEvents(membershipEventJoin),
		]);

		await stateService.persistStateEvent(membershipEventJoin);

		const state = await stateService.getFullRoomState2(roomCreateEvent.roomId);
		expect(state.isUserInRoom(newUser)).toBe(true);
	});

	test.todo('should not allow joining if banned', async () => {
		const roomCreateEvent = await createRoom('public');
		const newUser = '@bob:example.com';
		// join first
		const membershipEventJoin = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			newUser,
			newUser,
			'join',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEventJoin),
			stateService.addPrevEvents(membershipEventJoin),
		]);

		await stateService.persistStateEvent(membershipEventJoin);

		expect(
			(
				await stateService.getFullRoomState2(roomCreateEvent.roomId)
			).isUserInRoom(newUser),
		).toBeTrue();

		const membershipEventBan = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
			newUser,
			'ban',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEventBan),
			stateService.addPrevEvents(membershipEventBan),
		]);

		await stateService.persistStateEvent(membershipEventBan);

		expect(
			(
				await stateService.getFullRoomState2(roomCreateEvent.roomId)
			).getUserMembership(newUser),
		).toBe('ban');

		const membershipEventJoin2 = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			newUser,
			newUser,
			'join',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEventJoin2),
			stateService.addPrevEvents(membershipEventJoin2),
		]);

		await expect(
			stateService.persistStateEvent(membershipEventJoin2),
		).rejects.toThrowError();
	});

	test.todo('soft fail events', async () => {});

	test.todo('rejected events', async () => {});
});
