import { describe, expect, it, test } from 'bun:test';
import { type ConfigService } from './config.service';
import { DatabaseConnectionService } from './database-connection.service';
import { StateRepository, StateStore } from '../repositories/state.repository';
import { EventRepository } from '../repositories/event.repository';
import { type WithId } from 'mongodb';
import { type EventStore } from '@hs/core';
import { StateService } from './state.service';
import {
	PduCreateEventContent,
	PduPowerLevelsEventContent,
	PduRoomNameEventContent,
	PersistentEventFactory,
	RoomState,
	RoomVersion,
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

		return {
			roomCreateEvent,
			joinRuleEvent,
			powerLevelEvent,
			creatorMembershipEvent,
			roomNameEvent,
			canonicalAliasEvent,
		};
	};

	const joinUser = async (roomId: string, userId: string) => {
		return _setUserMembership(roomId, userId, 'join');
	};

	const banUser = async (roomId: string, userId: string, sender: string) => {
		return _setUserMembership(roomId, userId, 'ban', sender);
	};

	const leaveUser = async (roomId: string, userId: string) => {
		return _setUserMembership(roomId, userId, 'leave');
	};

	const inviteUser = async (roomId: string, userId: string, sender: string) => {
		return _setUserMembership(roomId, userId, 'invite', sender);
	};

	const _setUserMembership = async (
		roomId: string,
		userId: string,
		membership: string,
		sender?: string,
	) => {
		const state = await stateService.getFullRoomState2(roomId);
		const membershipEvent = PersistentEventFactory.newMembershipEvent(
			roomId,
			sender || userId,
			userId,
			membership as any,
			{ room_version: state.version } as any,
		);

		await Promise.all([
			stateService.addAuthEvents(membershipEvent),
			stateService.addPrevEvents(membershipEvent),
		]);

		await stateService.persistStateEvent(membershipEvent);

		return membershipEvent;
	};

	it('should create a room successfully', async () => {
		const {
			roomCreateEvent: { roomId },
		} = await createRoom('public');
		expect(roomId).toBeDefined();
		return expect(
			stateService.getFullRoomState2(roomId),
		).resolves.toBeDefined();
	});

	it('should successfully have a user join the room', async () => {
		const { roomCreateEvent } = await createRoom('public');

		const newUser = '@bob:example.com';

		await joinUser(roomCreateEvent.roomId, newUser);

		const state = await stateService.getFullRoomState2(roomCreateEvent.roomId);
		expect(state.isUserInRoom(newUser)).toBe(true);
	});

	it('should have a user leave the room successfully', async () => {
		const { roomCreateEvent } = await createRoom('public');
		const newUser = '@bob:example.com';

		await joinUser(roomCreateEvent.roomId, newUser);

		await leaveUser(roomCreateEvent.roomId, newUser);

		const state = await stateService.getFullRoomState2(roomCreateEvent.roomId);
		expect(state.isUserInRoom(newUser)).toBe(false);
	});

	it('should not allow joining if room is imenvite only', async () => {
		const { roomCreateEvent } = await createRoom('invite');
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
		const { roomCreateEvent } = await createRoom('invite');
		const newUser = '@bob:example.com';

		await inviteUser(
			roomCreateEvent.roomId,
			newUser,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
		);

		expect(
			(
				await stateService.getFullRoomState2(roomCreateEvent.roomId)
			).isUserInvited(newUser),
		).toBeTrue();

		await joinUser(roomCreateEvent.roomId, newUser);

		const state = await stateService.getFullRoomState2(roomCreateEvent.roomId);
		expect(state.isUserInRoom(newUser)).toBe(true);
	});

	test.todo('should not allow joining if banned', async () => {
		const { roomCreateEvent } = await createRoom('public');
		const newUser = '@bob:example.com';
		// join first
		await joinUser(roomCreateEvent.roomId, newUser);

		expect(
			(
				await stateService.getFullRoomState2(roomCreateEvent.roomId)
			).isUserInRoom(newUser),
		).toBeTrue();

		await banUser(
			roomCreateEvent.roomId,
			newUser,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
		);

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

	it('should soft fail events', async () => {
		const { roomCreateEvent } = await createRoom('public');

		// add a user
		const bob = '@bob:example.com';
		await joinUser(roomCreateEvent.roomId, bob);
		// ban bob now
		const banBobEvent = await banUser(
			roomCreateEvent.roomId,
			bob,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
		);

		const state1 = await stateService.getFullRoomState2(roomCreateEvent.roomId);
		expect(state1.getUserMembership(bob)).toBe('ban');

		// now we try to make bob "leave", but set the depth manually to be before he was banned
		// leave is a state event
		const bobLeaveEvent = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			bob,
			bob,
			'leave',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		const eventsBeforeBobWasBanned = await banBobEvent.getPreviousEvents(
			stateService._getStore(
				roomCreateEvent.getContent<PduCreateEventContent>()
					.room_version as RoomVersion,
			),
		);
		const authEventsForBobBan = await banBobEvent.getAuthorizationEvents(
			stateService._getStore(
				roomCreateEvent.getContent<PduCreateEventContent>()
					.room_version as RoomVersion,
			),
		); // should be the same for bob

		eventsBeforeBobWasBanned.forEach((element) => {
			bobLeaveEvent.addPreviousEvent(element);
		});

		authEventsForBobBan.forEach((e) => bobLeaveEvent.authedBy(e));

		await expect(
			stateService.persistStateEvent(bobLeaveEvent),
		).rejects.toThrowError();
	});

	it('should fix state in case of older event arriving late', async () => {
		const { roomCreateEvent, powerLevelEvent, roomNameEvent } =
			await createRoom('public');

		// add a user
		const bob = '@bob:example.com';
		await joinUser(roomCreateEvent.roomId, bob);

		const powerLevelContent = structuredClone(
			powerLevelEvent.getContent<PduPowerLevelsEventContent>(),
		);

		// we increase bob to 50 allowing room name change

		powerLevelContent.users[bob] = 50;

		const newPowerLevelEvent = PersistentEventFactory.newPowerLevelEvent(
			roomCreateEvent.roomId,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
			powerLevelContent,
			PersistentEventFactory.defaultRoomVersion,
		);

		await Promise.all([
			stateService.addAuthEvents(newPowerLevelEvent),
			stateService.addPrevEvents(newPowerLevelEvent),
		]);

		await stateService.persistStateEvent(newPowerLevelEvent);

		const state1 = await stateService.getFullRoomState2(roomCreateEvent.roomId);
		expect(state1.powerLevels?.users[bob]).toBe(50);

		// now we make bob change the room name, this should work
		const newRoomName = 'New Room Name';
		const roomNameEventByBob = PersistentEventFactory.newRoomNameEvent(
			roomCreateEvent.roomId,
			bob,
			newRoomName,
			PersistentEventFactory.defaultRoomVersion,
		);

		await Promise.all([
			stateService.addAuthEvents(roomNameEventByBob),
			stateService.addPrevEvents(roomNameEventByBob),
		]);

		await stateService.persistStateEvent(roomNameEventByBob);

		const state2 = await stateService.getFullRoomState2(roomCreateEvent.roomId);
		expect(state2.name).toBe(newRoomName);

		// we now mimick sending a ban event for bob, but before the power level event was sent
		const banBobEvent = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
			bob,
			'ban',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		const eventsBeforePowerLevel = await newPowerLevelEvent.getPreviousEvents(
			stateService._getStore(
				roomCreateEvent.getContent<PduCreateEventContent>()
					.room_version as RoomVersion,
			),
		);

		eventsBeforePowerLevel.forEach((element) => {
			banBobEvent.addPreviousEvent(element);
		});

		const stateBeforePowerLevelEvent = await stateService.findStateBeforeEvent(
			powerLevelEvent.eventId,
		);

		for (const requiredAuthEvent of banBobEvent.getAuthEventStateKeys()) {
			const authEvent = stateBeforePowerLevelEvent.get(requiredAuthEvent);
			if (authEvent) {
				banBobEvent.authedBy(authEvent);
			}
		}

		await stateService.persistStateEvent(banBobEvent);

		const state3 = await stateService.getFullRoomState2(roomCreateEvent.roomId);

		expect(state3.name).toBe(
			roomNameEvent.getContent<PduRoomNameEventContent>().name,
		); // should set the state to right versions
	});

	it('should not inifinitely append to prevStateIds but replace with the new state event being accepted for current state delta', async () => {
		const { roomCreateEvent, roomNameEvent } = await createRoom('public');

		const newUser = '@bob:example.com';

		await joinUser(roomCreateEvent.roomId, newUser);

		// each delta will point to the previous one, thus if we immediately leave, the previous state ids will NOT include the join state becuase the previous state itself is join state.
		// so we leave and rejoin to add a membership state in the list
		// any other state event will do as well, i just had these helper functions ready

		await leaveUser(roomCreateEvent.roomId, newUser);

		const mapping1 = await stateRepository.getLatestStateMapping(
			roomCreateEvent.roomId,
		);

		if (!mapping1) {
			throw new Error('No state mapping found');
		}

		await joinUser(roomCreateEvent.roomId, newUser);

		const mapping2 = await stateRepository.getLatestStateMapping(
			roomCreateEvent.roomId,
		);

		if (!mapping2) {
			throw new Error('No state mapping found');
		}

		expect(mapping1.prevStateIds.length).toBe(mapping2.prevStateIds.length);

		// a bunch of times
		await leaveUser(roomCreateEvent.roomId, newUser);
		await joinUser(roomCreateEvent.roomId, newUser);
		await leaveUser(roomCreateEvent.roomId, newUser);
		await joinUser(roomCreateEvent.roomId, newUser);
		await leaveUser(roomCreateEvent.roomId, newUser);
		await joinUser(roomCreateEvent.roomId, newUser);
		await leaveUser(roomCreateEvent.roomId, newUser);
		await joinUser(roomCreateEvent.roomId, newUser);

		const mapping3 = await stateRepository.getLatestStateMapping(
			roomCreateEvent.roomId,
		);

		if (!mapping3) {
			throw new Error('No state mapping found');
		}

		// prev ids will not grow indefinitely for any membership changes
		expect(mapping1.prevStateIds.length).toBe(mapping3.prevStateIds.length);

		// add a new room name now to see if it still holds for other event types
		const newRoomNameEvent = PersistentEventFactory.newRoomNameEvent(
			roomCreateEvent.roomId,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
			'New Room Name',
			PersistentEventFactory.defaultRoomVersion,
		);

		await Promise.all([
			stateService.addAuthEvents(newRoomNameEvent),
			stateService.addPrevEvents(newRoomNameEvent),
		]);

		await stateService.persistStateEvent(newRoomNameEvent);

		const mapping4 = await stateRepository.getLatestStateMapping(
			roomCreateEvent.roomId,
		);

		if (!mapping4) {
			throw new Error('No state mapping found');
		}

		// because state should already have a room name event;
		expect(mapping1.prevStateIds.length).toBe(mapping4.prevStateIds.length);

		// however must also make sure we can get the older state correctly
		const state = await stateService.findStateBeforeEvent(
			newRoomNameEvent.eventId,
		); // before this event, the room name should be the old one

		expect(
			state.get('m.room.name:')?.getContent<PduRoomNameEventContent>().name,
		).toBe(roomNameEvent.getContent<PduRoomNameEventContent>().name);
	});

	it('should fix state in case of older event arriving late (2)', async () => {
		const { roomCreateEvent } = await createRoom('public');

		// add a user
		const bob = '@bob:example.com';
		await joinUser(roomCreateEvent.roomId, bob);

		const diego = '@diego:example.com';
		await joinUser(roomCreateEvent.roomId, diego);

		const joinRuleInvite = PersistentEventFactory.newJoinRuleEvent(
			roomCreateEvent.roomId,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
			'invite',
			PersistentEventFactory.defaultRoomVersion,
		);

		// we will NOT fill or send the event yet.

		const randomUser1 = '@random1:example.com';
		const randomUserJoinEvent = await joinUser(
			roomCreateEvent.roomId,
			randomUser1,
		);

		const randomUser2 = '@random2:example.com';
		await joinUser(roomCreateEvent.roomId, randomUser2);

		const state1 = await stateService.getFullRoomState2(roomCreateEvent.roomId);

		expect(state1.isUserInRoom(randomUser1)).toBe(true);
		expect(state1.isUserInRoom(randomUser2)).toBe(true);

		// join rule was changed before randomuser joined
		const store = stateService._getStore(state1.version);

		const previousEventsForJoinRUle =
			await randomUserJoinEvent.getPreviousEvents(store);
		previousEventsForJoinRUle.forEach((e) =>
			joinRuleInvite.addPreviousEvent(e),
		);

		// while the join doesn't affect the auth events for joinrule, still doing it this way as an example for the correct way
		const stateBeforeRandomUserJoin = await stateService.findStateBeforeEvent(
			randomUserJoinEvent.eventId,
		);
		for (const requiredAuthEvent of joinRuleInvite.getAuthEventStateKeys()) {
			const authEvent = stateBeforeRandomUserJoin.get(requiredAuthEvent);
			if (authEvent) {
				joinRuleInvite.authedBy(authEvent);
			}
		}

		await stateService.persistStateEvent(joinRuleInvite);

		const _state2 = await stateService.findStateAtEvent(joinRuleInvite.eventId);

		const state2 = new RoomState(_state2);

		console.log('state', [..._state2.entries()]);

		expect(state2.isUserInRoom(randomUser1)).toBe(false);
		expect(state2.isUserInRoom(randomUser2)).toBe(false);
	});

	test.todo('rejected events', async () => {});
});
