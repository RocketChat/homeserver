import { describe, expect, it, spyOn, test } from 'bun:test';
import { type EventStore } from '@rocket.chat/federation-core';
import * as room from '@rocket.chat/federation-room';
import {
	EventID,
	PduCreateEventContent,
	PduJoinRuleEventContent,
	PduPowerLevelsEventContent,
	PduRoomNameEventContent,
	PersistentEventBase,
	PersistentEventFactory,
	RejectCodes,
	RoomVersion,
	StateMapKey,
} from '@rocket.chat/federation-room';
import { type WithId } from 'mongodb';
import { EventRepository } from '../repositories/event.repository';
import {
	StateGraphRepository,
	StateGraphStore,
} from '../repositories/state-graph.repository';
import { type ConfigService } from './config.service';
import { DatabaseConnectionService } from './database-connection.service';
import { StateService } from './state.service';

type State = Map<StateMapKey, PersistentEventBase>;

function getDefaultFields() {
	return {
		auth_events: [],
		prev_events: [],
		origin_server_ts: Date.now(),
		depth: 0,
	};
}

function copyEventAndTransform<T extends PersistentEventBase>(
	e: T,
	fn: (obj: PersistentEventBase['event']) => typeof obj,
): T {
	const { event } = e;

	return PersistentEventFactory.createFromRawEvent(fn(event), e.version) as T;
}

function stripPreviousEvents<T extends PersistentEventBase>(e: T): T {
	return copyEventAndTransform(e, (obj) => {
		const modify = JSON.parse(JSON.stringify(obj));
		modify.prev_events = [];

		return modify;
	});
}

function stripPreviousAndAuthEvents<T extends PersistentEventBase>(e: T): T {
	return copyEventAndTransform(e, (obj) => {
		const modify = JSON.parse(JSON.stringify(obj));
		modify.prev_events = [];
		modify.auth_events = [];

		return modify;
	});
}

function compareStates(state1: State, state2: typeof state1) {
	// convert to an object with eventy.eventId
	const s1 = Object.entries(Object.fromEntries(state1.entries())).reduce(
		(acc, [key, event]) => {
			acc[key] = event.eventId;
			return acc;
		},
		{} as Record<string, EventID>,
	);

	const s2 = Object.entries(Object.fromEntries(state2.entries())).reduce(
		(acc, [key, event]) => {
			acc[key] = event.eventId;
			return acc;
		},
		{} as Record<string, EventID>,
	);

	expect(s1).toEqual(s2);
}

let stateService: StateService;

async function copyDepth<
	F extends PersistentEventBase,
	T extends PersistentEventBase,
>(from: F, to: T): Promise<T> {
	const store = stateService._getStore(from.version);

	const previousEvents = await store.getEvents(from.getPreviousEventIds());

	const toStripped = stripPreviousAndAuthEvents(to);

	toStripped.addPrevEvents(previousEvents);

	const state = await stateService.getStateAtEvent(from);

	for (const key of to.getAuthEventStateKeys()) {
		const event = state.get(key);
		if (event) {
			toStripped.authedBy(event);
		}
	}

	(toStripped as any).rawEvent.depth = from.depth;

	return toStripped;
}

describe('StateService', async () => {
	if (process.env.NODE_ENV !== 'test') {
		console.warn('Skipping tests that require a database');
		return;
	}

	const databaseConfig = {
		uri: 'mongodb://localhost:27017',
		name: 'matrix_test',
		poolSize: 100,
	};

	const configServiceInstance = {
		getSigningKey: async () => {},
		serverName: 'example.com',
		database: databaseConfig,
		getDatabaseConfig: () => databaseConfig,
	} as unknown as ConfigService;

	const database = new DatabaseConnectionService(configServiceInstance);

	const eventCollection = (await database.getDb()).collection<
		WithId<EventStore>
	>('events_test');
	const stateGraphCollection = (
		await database.getDb()
	).collection<StateGraphStore>('state_graph_test');

	const eventRepository = new EventRepository(eventCollection);
	const stateGraphRepository = new StateGraphRepository(stateGraphCollection);

	// TODO: use IStateService
	stateService = new StateService(
		stateGraphRepository,
		eventRepository,
		configServiceInstance,
	);

	const createRoom = async (
		joinRule: PduJoinRuleEventContent['join_rule'],
		userPowers: PduPowerLevelsEventContent['users'] = {},
	) => {
		const username = '@alice:example.com';
		const name = 'Test Room';

		const roomCreateEvent = PersistentEventFactory.newCreateEvent(
			username,
			PersistentEventFactory.defaultRoomVersion,
		);
		await stateService.handlePdu(roomCreateEvent);

		const roomVersion: RoomVersion =
			roomCreateEvent.getContent<PduCreateEventContent>().room_version;

		const creatorMembershipEvent =
			await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					room_id: roomCreateEvent.roomId,
					sender: username,
					state_key: username,
					content: { membership: 'join' },
					...getDefaultFields(),
				},
				roomVersion,
			);

		await stateService.handlePdu(creatorMembershipEvent);

		const roomNameEvent = await stateService.buildEvent<'m.room.name'>(
			{
				room_id: roomCreateEvent.roomId,
				sender: username,
				content: { name },
				state_key: '',
				type: 'm.room.name',
				...getDefaultFields(),
			},
			roomVersion,
		);

		await stateService.handlePdu(roomNameEvent);

		const powerLevelEvent =
			await stateService.buildEvent<'m.room.power_levels'>(
				{
					type: 'm.room.power_levels',
					room_id: roomCreateEvent.roomId,
					sender: username,
					state_key: '',
					content: {
						users: {
							[username]: 100,
							...userPowers,
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
					...getDefaultFields(),
				},
				roomVersion,
			);

		await stateService.handlePdu(powerLevelEvent);

		const joinRuleEvent = await stateService.buildEvent<'m.room.join_rules'>(
			{
				room_id: roomCreateEvent.roomId,
				sender: username,
				content: { join_rule: joinRule },
				type: 'm.room.join_rules',
				state_key: '',
				...getDefaultFields(),
			},
			roomVersion,
		);

		await stateService.handlePdu(joinRuleEvent);

		return {
			roomCreateEvent,
			joinRuleEvent,
			powerLevelEvent,
			creatorMembershipEvent,
			roomNameEvent,
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
		const roomVersion = await stateService.getRoomVersion(roomId);
		const membershipEvent = await stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				room_id: roomId,
				sender: sender || userId,
				state_key: userId,
				content: { membership: membership as any },
				...getDefaultFields(),
			},
			roomVersion,
		);

		await stateService.handlePdu(membershipEvent);

		return membershipEvent;
	};

	it('001 should correctly calculate state through linear changes', async () => {
		const {
			roomCreateEvent,
			roomNameEvent,
			joinRuleEvent,
			powerLevelEvent,
			creatorMembershipEvent,
		} = await createRoom('public');

		const stateAtEvent = new Map<EventID, State>();

		const roomId = roomCreateEvent.roomId;
		const creator = roomCreateEvent.getContent().creator;

		const state = await stateService.getLatestRoomState(roomId);

		// check each event
		expect(
			state.get(roomCreateEvent.getUniqueStateIdentifier()),
		).toHaveProperty('eventId', roomCreateEvent.eventId);
		expect(state.get(roomNameEvent.getUniqueStateIdentifier())).toHaveProperty(
			'eventId',
			roomNameEvent.eventId,
		);
		expect(state.get(joinRuleEvent.getUniqueStateIdentifier())).toHaveProperty(
			'eventId',
			joinRuleEvent.eventId,
		);
		expect(
			state.get(powerLevelEvent.getUniqueStateIdentifier()),
		).toHaveProperty('eventId', powerLevelEvent.eventId);
		expect(
			state.get(creatorMembershipEvent.getUniqueStateIdentifier()),
		).toHaveProperty('eventId', creatorMembershipEvent.eventId);

		expect(state.size).toBe(5);

		const bob = '@bob:example.com';
		const bobJoinEvent = await joinUser(roomId, bob);

		const state2 = await stateService.getLatestRoomState(roomId);
		expect(state2.size).toBe(6);
		expect(state2.get(bobJoinEvent.getUniqueStateIdentifier())).toHaveProperty(
			'eventId',
			bobJoinEvent.eventId,
		);

		stateAtEvent.set(bobJoinEvent.eventId, state2);

		const bobLeaveEvent = await leaveUser(roomId, bob);
		const state3 = await stateService.getLatestRoomState(roomId);

		expect(state3.size).toBe(6); // same as before
		expect(state3.get(bobLeaveEvent.getUniqueStateIdentifier())).toHaveProperty(
			'eventId',
			bobLeaveEvent.eventId,
		);

		stateAtEvent.set(bobLeaveEvent.eventId, state3);

		// do same for random1 and random2
		const random1 = '@random1:example.com';
		const random1JoinEvent = await joinUser(roomId, random1);
		const state4 = await stateService.getLatestRoomState(roomId);
		expect(state4.size).toBe(7);
		expect(
			state4.get(random1JoinEvent.getUniqueStateIdentifier()),
		).toHaveProperty('eventId', random1JoinEvent.eventId);
		const random2 = '@random2:example.com';
		const random2JoinEvent = await joinUser(roomId, random2);
		const state5 = await stateService.getLatestRoomState(roomId);
		expect(state5.size).toBe(8);
		expect(
			state5.get(random2JoinEvent.getUniqueStateIdentifier()),
		).toHaveProperty('eventId', random2JoinEvent.eventId);

		stateAtEvent.set(random1JoinEvent.eventId, state4);
		stateAtEvent.set(random2JoinEvent.eventId, state5);

		// change room name now
		const newRoomName = 'New Room Name';
		const roomNameEvent2 = await stateService.buildEvent<'m.room.name'>(
			{
				room_id: roomId,
				sender: roomCreateEvent.getContent<PduCreateEventContent>().creator,
				content: { name: newRoomName },
				state_key: '',
				type: 'm.room.name',
				...getDefaultFields(),
			},
			roomCreateEvent.getContent().room_version,
		);
		await stateService.handlePdu(roomNameEvent2);
		const state6 = await stateService.getLatestRoomState(roomId);
		expect(state6.size).toBe(8); // same as before, overwriting existing name
		expect(
			state6.get(roomNameEvent2.getUniqueStateIdentifier()),
		).toHaveProperty('eventId', roomNameEvent2.eventId);

		stateAtEvent.set(roomNameEvent2.eventId, state6);

		// ban random1
		const random3 = '@random3:example.com';
		const banRandom1Event = await banUser(roomId, random3, creator);
		const state7 = await stateService.getLatestRoomState(roomId);
		expect(state7.size).toBe(9);
		expect(
			state7.get(banRandom1Event.getUniqueStateIdentifier()),
		).toHaveProperty('eventId', banRandom1Event.eventId);

		stateAtEvent.set(banRandom1Event.eventId, state7);

		// have random3 change the name of the room
		const roomNameEvent3 = await stateService.buildEvent<'m.room.name'>(
			{
				room_id: roomId,
				sender: random3,
				content: { name: 'Hacked Name' },
				state_key: '',
				type: 'm.room.name',
				...getDefaultFields(),
			},
			roomCreateEvent.getContent().room_version,
		);
		await stateService.handlePdu(roomNameEvent3);
		const state8 = await stateService.getLatestRoomState(roomId);
		expect(state8.size).toBe(9); // same as before, bob was banned can't change name
		compareStates(state7, state8);

		const stateShouldBe6 = await stateService.getStateAtEvent(roomNameEvent2);
		compareStates(stateAtEvent.get(roomNameEvent2.eventId)!, stateShouldBe6);

		// send a message
		const message = await stateService.buildEvent<'m.room.message'>(
			{
				type: 'm.room.message',
				room_id: roomId,
				sender: creator,
				content: { msgtype: 'm.text', body: '' },
				...getDefaultFields(),
			},
			roomCreateEvent.version,
		);

		await stateService.handlePdu(message);

		const state9 = await stateService.getLatestRoomState(roomId);
		compareStates(state9, state8); // shouldn't change state

		const stateAtMessage = await stateService.getStateAtEvent(message);
		compareStates(stateAtMessage, state9);
	});

	it('01 should return the correct room information for room id', async () => {
		expect(stateService.getRoomInformation('abcd')).rejects.toThrowError(
			/Create event mapping not found/,
		);

		const { roomCreateEvent } = await createRoom('public');

		expect(
			stateService.getRoomInformation(roomCreateEvent.roomId),
		).resolves.toHaveProperty(
			'creator',
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
		);
	});

	it('02 should get the correct room version', async () => {
		const { roomCreateEvent } = await createRoom('public');

		const roomVersion = await stateService.getRoomVersion(
			roomCreateEvent.roomId,
		);

		expect(roomVersion).toBe(
			roomCreateEvent.getContent<PduCreateEventContent>()
				.room_version as RoomVersion,
		);

		expect(stateService.getRoomVersion('roomId')).rejects.toThrowError();
	});

	it('03 should find the correct state at an event', async () => {
		const { roomCreateEvent } = await createRoom('public');

		const events = await Promise.all([
			joinUser(roomCreateEvent.roomId, '@bob:example.com'),
			joinUser(roomCreateEvent.roomId, '@charlie:example.com'),
			// random1
			joinUser(roomCreateEvent.roomId, '@random1:example.com'),
			joinUser(roomCreateEvent.roomId, '@random2:example.com'),
		]);

		// at each event the corresponding user should be in state

		for (const event of events) {
			const stateAtEvent = await stateService.getStateAtEvent(event);
			expect(
				stateAtEvent.get(event.getUniqueStateIdentifier())?.getContent(),
			).toHaveProperty('membership', 'join');
		}
	});

	// NOTE: need state_id implementation and correlate with synapse to confirm the behavior
	// challenge is if we get a duplicate and drop it from state, but is still part of prev_events as new events come in, how are we supposed to behave then?
	// at the same time if we send out a duplicate, it will be dropped by the other side, but we will continue to
	// add it in prev_events.
	// idempotency both ways is important, at the same time need to be able to handle non idempotent requests
	test.failing('should make idempotent state changes', async () => {
		const { roomCreateEvent } = await createRoom('public');

		const newUser = '@bob:example.com';

		const joinEvent1 = await joinUser(roomCreateEvent.roomId, newUser);

		const state1 = await stateService.getLatestRoomState(
			roomCreateEvent.roomId,
		);
		expect(state1.get(joinEvent1.getUniqueStateIdentifier())).toHaveProperty(
			'eventId',
			joinEvent1.eventId,
		);

		const joinEvent2 = await joinUser(roomCreateEvent.roomId, newUser);

		expect(joinEvent1.eventId).not.toBe(joinEvent2.eventId);

		const state2 = await stateService.getLatestRoomState(
			roomCreateEvent.roomId,
		);
		expect(state2.get(joinEvent2.getUniqueStateIdentifier())).toHaveProperty(
			'eventId',
			joinEvent1.eventId, // same as old eventid
		);
	});

	it('05 should create a room successfully', async () => {
		const {
			roomCreateEvent: { roomId },
		} = await createRoom('public');
		expect(roomId).toBeDefined();
		return expect(
			stateService.getLatestRoomState2(roomId),
		).resolves.toBeDefined();
	});

	it('06 should successfully have a user join the room', async () => {
		const { roomCreateEvent } = await createRoom('public');

		const newUser = '@bob:example.com';

		await joinUser(roomCreateEvent.roomId, newUser);

		const state = await stateService.getLatestRoomState2(
			roomCreateEvent.roomId,
		);
		expect(state.isUserInRoom(newUser)).toBe(true);
	});

	it('07 should have a user leave the room successfully', async () => {
		const { roomCreateEvent } = await createRoom('public');
		const newUser = '@bob:example.com';

		await joinUser(roomCreateEvent.roomId, newUser);

		await leaveUser(roomCreateEvent.roomId, newUser);

		const state = await stateService.getLatestRoomState2(
			roomCreateEvent.roomId,
		);
		expect(state.getUserMembership(newUser)).toBe('leave');
	});

	it('08 should not allow joining if room is imenvite only', async () => {
		const { roomCreateEvent } = await createRoom('invite');
		const newUser = '@bob:example.com';
		const membershipEvent = await stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				room_id: roomCreateEvent.roomId,
				sender: newUser,
				state_key: newUser,
				content: { membership: 'join' },
				...getDefaultFields(),
			},
			roomCreateEvent.getContent<PduCreateEventContent>().room_version,
		);

		await stateService.handlePdu(membershipEvent);

		expect(membershipEvent.rejected).toBeTrue();
		expect(membershipEvent.rejectCode).toBe(RejectCodes.AuthError);
	});

	it('09 should allow joining if invited in invite only room', async () => {
		const { roomCreateEvent } = await createRoom('invite');
		const newUser = '@bob:example.com';

		await inviteUser(
			roomCreateEvent.roomId,
			newUser,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
		);

		expect(
			(
				await stateService.getLatestRoomState2(roomCreateEvent.roomId)
			).isUserInvited(newUser),
		).toBeTrue();

		await joinUser(roomCreateEvent.roomId, newUser);

		const state = await stateService.getLatestRoomState2(
			roomCreateEvent.roomId,
		);
		expect(state.isUserInRoom(newUser)).toBe(true);
	});

	it('10 should not allow joining if banned', async () => {
		const { roomCreateEvent } = await createRoom('public');
		const newUser = '@bob:example.com';
		// join first
		await joinUser(roomCreateEvent.roomId, newUser);

		expect(
			(
				await stateService.getLatestRoomState2(roomCreateEvent.roomId)
			).isUserInRoom(newUser),
		).toBeTrue();

		await banUser(
			roomCreateEvent.roomId,
			newUser,
			roomCreateEvent.getContent<PduCreateEventContent>().creator,
		);

		expect(
			(
				await stateService.getLatestRoomState2(roomCreateEvent.roomId)
			).getUserMembership(newUser),
		).toBe('ban');

		const membershipEventJoin2 = await stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				room_id: roomCreateEvent.roomId,
				sender: newUser,
				state_key: newUser,
				content: { membership: 'join' },
				...getDefaultFields(),
			},
			roomCreateEvent.getContent<PduCreateEventContent>().room_version,
		);

		await stateService.handlePdu(membershipEventJoin2);
		expect(membershipEventJoin2.rejected).toBeTrue();
		expect(membershipEventJoin2.rejectCode).toBe(RejectCodes.AuthError);
	});

	it('11 should soft fail events', async () => {
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

		const state1 = await stateService.getLatestRoomState2(
			roomCreateEvent.roomId,
		);
		expect(state1.getUserMembership(bob)).toBe('ban');

		// now we try to make bob "leave", but set the depth manually to be before he was banned
		// leave is a state event
		const bobLeaveEvent = stripPreviousAndAuthEvents(
			await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					room_id: roomCreateEvent.roomId,
					sender: bob,
					state_key: bob,
					content: { membership: 'leave' },
					...getDefaultFields(),
				},
				roomCreateEvent.getContent<PduCreateEventContent>().room_version,
			),
		);

		const store = stateService._getStore(
			roomCreateEvent.getContent<PduCreateEventContent>()
				.room_version as RoomVersion,
		);

		const eventsBeforeBobWasBanned = await store.getEvents(
			banBobEvent.getPreviousEventIds(),
		);

		const authEventsForBobBan = await store.getEvents(
			banBobEvent.getAuthEventIds(),
		); // should be the same for bob

		bobLeaveEvent.addPrevEvents(eventsBeforeBobWasBanned);

		// biome-ignore lint/complexity/noForEach: <explanation>
		authEventsForBobBan.forEach((e) => bobLeaveEvent.authedBy(e));

		expect(stateService.handlePdu(bobLeaveEvent)).rejects.toThrow();
		expect(bobLeaveEvent.rejected).toBeTrue();
		expect(bobLeaveEvent.rejectCode).toBe(RejectCodes.AuthError);
	});

	it('01#arriving_late should fix state in case of older event arriving late', async () => {
		const { roomCreateEvent, powerLevelEvent, roomNameEvent } =
			await createRoom('public');

		const roomId = roomCreateEvent.roomId;

		// add a user
		const bob = '@bob:example.com';
		await joinUser(roomCreateEvent.roomId, bob);

		const powerLevelContent = structuredClone(powerLevelEvent.getContent());

		// we increase bob to 50 allowing room name change

		powerLevelContent.users[bob] = 50;

		const newPowerLevelEvent =
			await stateService.buildEvent<'m.room.power_levels'>(
				{
					type: 'm.room.power_levels',
					room_id: roomCreateEvent.roomId,
					sender: roomCreateEvent.getContent<PduCreateEventContent>().creator,
					state_key: '',
					content: powerLevelContent,
					...getDefaultFields(),
				},
				PersistentEventFactory.defaultRoomVersion,
			);

		await stateService.handlePdu(newPowerLevelEvent);

		const state1 = await stateService.getLatestRoomState2(
			roomCreateEvent.roomId,
		);
		expect(state1.powerLevels?.users[bob]).toBe(50);

		// now we make bob change the room name, this should work
		const newRoomName = 'New Room Name';
		const roomNameEventByBob = await stateService.buildEvent<'m.room.name'>(
			{
				room_id: roomCreateEvent.roomId,
				sender: bob,
				content: { name: newRoomName },
				state_key: '',
				type: 'm.room.name',
				...getDefaultFields(),
			},
			PersistentEventFactory.defaultRoomVersion,
		);

		await stateService.handlePdu(roomNameEventByBob);

		expect((await stateService.getLatestRoomState2(roomId)).name).toBe(
			newRoomName,
		);

		// add another delta so both events point to the same state
		const state2 = await stateService.getLatestRoomState2(
			roomCreateEvent.roomId,
		);
		expect(state2.name).toBe(newRoomName);

		// we now mimick sending a ban event for bob, but before the power level event was sent
		const banBobEvent = stripPreviousAndAuthEvents(
			await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					room_id: roomCreateEvent.roomId,
					sender: roomCreateEvent.getContent<PduCreateEventContent>().creator,
					state_key: bob,
					content: { membership: 'ban' },
					...getDefaultFields(),
				},
				roomCreateEvent.getContent<PduCreateEventContent>()
					.room_version as RoomVersion,
			),
		);

		const store = stateService._getStore(
			roomCreateEvent.getContent<PduCreateEventContent>()
				.room_version as RoomVersion,
		);

		const eventsBeforePowerLevel = await store.getEvents(
			newPowerLevelEvent.getPreviousEventIds(),
		);

		banBobEvent.addPrevEvents(eventsBeforePowerLevel);

		const stateBeforePowerLevelEvent =
			await stateService.getStateBeforeEvent(powerLevelEvent);

		for (const requiredAuthEvent of banBobEvent.getAuthEventStateKeys()) {
			const authEvent = stateBeforePowerLevelEvent.get(requiredAuthEvent);
			if (authEvent) {
				banBobEvent.authedBy(authEvent);
			}
		}

		await stateService.handlePdu(banBobEvent);

		const state3 = await stateService.getLatestRoomState2(
			roomCreateEvent.roomId,
		);

		// console.log((stte3 as any).stateMap);

		expect(state3.name).toBe(
			roomNameEvent.getContent<PduRoomNameEventContent>().name,
		); // should set the state to right versions
	});

	it('02#arriving_late should fix state in case of older event arriving late', async () => {
		const { roomCreateEvent } = await createRoom('public');

		// add a user
		const bob = '@bob:example.com';
		await joinUser(roomCreateEvent.roomId, bob);

		const diego = '@diego:example.com';
		await joinUser(roomCreateEvent.roomId, diego);

		const joinRuleInvite = stripPreviousAndAuthEvents(
			await stateService.buildEvent<'m.room.join_rules'>(
				{
					room_id: roomCreateEvent.roomId,
					sender: roomCreateEvent.getContent<PduCreateEventContent>().creator,
					content: { join_rule: 'invite' },
					type: 'm.room.join_rules',
					state_key: '',
					...getDefaultFields(),
				},
				PersistentEventFactory.defaultRoomVersion,
			),
		);

		// we will NOT fill or send the event yet.

		const randomUser1 = '@random1:example.com';
		const randomUserJoinEvent = await joinUser(
			roomCreateEvent.roomId,
			randomUser1,
		);

		const randomUser2 = '@random2:example.com';
		await joinUser(roomCreateEvent.roomId, randomUser2);

		const state1 = await stateService.getLatestRoomState2(
			roomCreateEvent.roomId,
		);

		expect(state1.isUserInRoom(randomUser1)).toBe(true);
		expect(state1.isUserInRoom(randomUser2)).toBe(true);

		// join rule was changed before randomuser joined
		const store = stateService._getStore(state1.version);

		const previousEventIdsForJoinRule =
			randomUserJoinEvent.getPreviousEventIds();
		const previousEventsForJoinRule = await store.getEvents(
			previousEventIdsForJoinRule,
		);
		joinRuleInvite.addPrevEvents(previousEventsForJoinRule);

		// while the join doesn't affect the auth events for joinrule, still doing it this way as an example for the correct way
		const stateBeforeRandomUserJoin =
			await stateService.getStateBeforeEvent(randomUserJoinEvent);
		for (const requiredAuthEvent of joinRuleInvite.getAuthEventStateKeys()) {
			const authEvent = stateBeforeRandomUserJoin.get(requiredAuthEvent);
			if (authEvent) {
				joinRuleInvite.authedBy(authEvent);
			}
		}

		await stateService.handlePdu(joinRuleInvite);

		// const _state2 = await stateService.findStateAtEvent(joinRuleInvite.eventId);

		// const state2 = new RoomState(_state2);

		// console.log('state', [..._state2.entries()]);

		const state2 = await stateService.getLatestRoomState2(
			roomCreateEvent.roomId,
		);

		expect(state2.isUserInRoom(randomUser1)).toBe(false);
		expect(state2.isUserInRoom(randomUser2)).toBe(false);
	});

	// it('should minimize amount of required state resolutions', async () => {
	// 	const spy = spyOn(room, 'resolveStateV2Plus');
	// 	// once an old event gets to us, we run state res.
	// 	// assume the state res stored new deltas randomly, would cause forward extremeties to behave the same way.
	// 	// the next new event we will receive, should be pointing to the latest state, for that to happenm
	// 	// we must make sure we associate latest state with the latest event we could have at that time.
	// 	// ---
	// 	// create a room
	// 	// do stuff
	// 	// send an out of order event
	// 	// now send a normal event
	// 	// see if it triggered stat res or not
	// 	// ---
	// 	const { roomCreateEvent, powerLevelEvent } = await createRoom('public');

	// 	// add a user
	// 	const bob = '@bob:example.com';
	// 	await joinUser(roomCreateEvent.roomId, bob);

	// 	const powerLevelContent = structuredClone(
	// 		powerLevelEvent.getContent<PduPowerLevelsEventContent>(),
	// 	);

	// 	// we increase bob to 50 allowing room name change

	// 	powerLevelContent.users[bob] = 50;

	// 	const newPowerLevelEvent = PersistentEventFactory.newPowerLevelEvent(
	// 		roomCreateEvent.roomId,
	// 		roomCreateEvent.getContent<PduCreateEventContent>().creator,
	// 		powerLevelContent,
	// 		PersistentEventFactory.defaultRoomVersion,
	// 	);

	// 	await Promise.all([
	// 		stateService.addAuthEvents(newPowerLevelEvent),
	// 		stateService.addPrevEvents(newPowerLevelEvent),
	// 	]);

	// 	// to test the out of order saving, and state res being triggered, we need to force multiple state deltas to be created.
	// 	// one will be the current one that triggers a new delta.
	// 	// we'll also need an event that is supposed to be valid but was rejected previouysly
	// 	// trhe power level event is supposed to "allow" bob to change the room name
	// 	// but we processed/received the name change first.

	// 	// increase the graph
	// 	await Promise.all([
	// 		joinUser(roomCreateEvent.roomId, '@random1:example.com'),
	// 		joinUser(roomCreateEvent.roomId, '@random2:example.com'),
	// 		joinUser(roomCreateEvent.roomId, '@random3:example.com'),
	// 		joinUser(roomCreateEvent.roomId, '@random4:example.com'),
	// 		joinUser(roomCreateEvent.roomId, '@random5:example.com'),
	// 		joinUser(roomCreateEvent.roomId, '@random6:example.com'),
	// 		joinUser(roomCreateEvent.roomId, '@random7:example.com'),
	// 		joinUser(roomCreateEvent.roomId, '@random8:example.com'),
	// 		joinUser(roomCreateEvent.roomId, '@random9:example.com'),
	// 	]);

	// 	// bob tries to change the room name, but at this point the power level event has not been "sent" yet

	// 	const bobChangeNameEvent = PersistentEventFactory.newRoomNameEvent(
	// 		roomCreateEvent.roomId,
	// 		bob,
	// 		'Bob Changed Name',
	// 		PersistentEventFactory.defaultRoomVersion,
	// 	);

	// 	await Promise.all([
	// 		stateService.addAuthEvents(bobChangeNameEvent),
	// 		stateService.addPrevEvents(bobChangeNameEvent),
	// 	]);

	// 	await stateService.handlePdu(bobChangeNameEvent);

	// 	expect(bobChangeNameEvent.rejected).toBeTrue();
	// 	expect(bobChangeNameEvent.rejectCode).toBe(RejectReason.AuthError);
	// 	expect(bobChangeNameEvent.rejectedBy).toBe(powerLevelEvent.eventId);

	// 	// ^ rejected event, will not participate in graph, thus nextEventId stays the same (for our immplementatioon)

	// 	// since name change event was rejected, it did not create a new state delta
	// 	// need to send another to now create one
	// });

	it('should list correct servers for a room', async () => {
		const { roomCreateEvent } = await createRoom('public');

		// add a user
		const bob = '@bob:example.com';
		await joinUser(roomCreateEvent.roomId, bob);

		const diego = '@diego:example.com';
		await joinUser(roomCreateEvent.roomId, diego);

		const servers = await stateService.getServersInRoom(roomCreateEvent.roomId);
		expect(servers).toContain('example.com');
		expect(servers.length).toBe(1);

		const remoteUser = '@alice:remote.com';
		await joinUser(roomCreateEvent.roomId, remoteUser);

		const servers2 = await stateService.getServersInRoom(
			roomCreateEvent.roomId,
		);
		expect(servers2).toContain('example.com');
		expect(servers2).toContain('remote.com');
		expect(servers2.length).toBe(2);

		// now leave the remote user
		await leaveUser(roomCreateEvent.roomId, remoteUser);

		const servers3 = await stateService.getServersInRoom(
			roomCreateEvent.roomId,
		);
		expect(servers3).toContain('example.com');
		expect(servers3.length).toBe(1);

		// now add her again
		await joinUser(roomCreateEvent.roomId, remoteUser);

		const servers4 = await stateService.getServersInRoom(
			roomCreateEvent.roomId,
		);
		expect(servers4).toContain('example.com');
		expect(servers4).toContain('remote.com');
		expect(servers4.length).toBe(2);
	});

	it('should allow previously rejected events through multiple state resolutions', async () => {
		const { roomCreateEvent } = await createRoom('public');
		const roomId = roomCreateEvent.roomId;
		const roomVersion = roomCreateEvent.getContent().room_version;
		const creator = roomCreateEvent.getContent().creator;

		const referenceDepthEvent = await joinUser(roomId, '@dummy:example.com');

		// try to join
		const bob = '@bob:example.com';
		const bobJoinEvent = await joinUser(roomId, bob);
		expect(bobJoinEvent.rejected).toBeFalse();

		const joinRuleEvent = await copyDepth(
			referenceDepthEvent,
			await stateService.buildEvent<'m.room.join_rules'>(
				{
					type: 'm.room.join_rules',
					content: { join_rule: 'invite' },
					room_id: roomId,
					state_key: '',
					sender: creator,
					...getDefaultFields(),
				},
				roomVersion,
			),
		);

		await stateService.handlePdu(joinRuleEvent);

		// should have triggered a state res, causing bob to no longer be part of the room
		const state1 = await stateService.getLatestRoomState2(roomId);

		expect(state1.isUserInRoom(bob)).toBeFalse();

		// but what if join rule were to be immediately switched back?
		const joinRulePublicEvent = await copyDepth(
			joinRuleEvent,
			await stateService.buildEvent<'m.room.join_rules'>(
				{
					type: 'm.room.join_rules',
					sender: creator,
					state_key: '',
					room_id: roomId,
					content: { join_rule: 'public' },
					...getDefaultFields(),
				},
				roomVersion,
			),
		);

		await stateService.handlePdu(joinRulePublicEvent);

		const state2 = await stateService.getLatestRoomState2(roomId);

		expect(state2.isPublic()).toBeTrue();
		expect(state2.isUserInRoom(bob)).toBeTrue();
	});

	it('should consider previously rejected event as part of state if new out of order event allows it', async () => {
		const { roomCreateEvent } = await createRoom('public');
		const roomId = roomCreateEvent.roomId;
		const creator = roomCreateEvent.getContent().creator;
		const roomVersion = roomCreateEvent.version;

		// make bob join
		const bob = '@bob:example.com';
		const bobJoinEvent = await joinUser(roomId, bob);
		const state1 = await stateService.getLatestRoomState2(roomId);
		expect(state1.isUserInRoom(bob)).toBeTrue();

		// change join rule to private
		const joinRuleInvite = await copyDepth(
			bobJoinEvent,
			await stateService.buildEvent<'m.room.join_rules'>(
				{
					type: 'm.room.join_rules',
					sender: creator,
					state_key: '',
					room_id: roomId,
					content: { join_rule: 'invite' },
					...getDefaultFields(),
				},
				roomVersion,
			),
		);

		await stateService.handlePdu(joinRuleInvite);

		// bob not in room
		const state2 = await stateService.getLatestRoomState2(roomId);
		expect(state2.isInviteOnly()).toBeTrue();
		expect(state2.isUserInRoom(bob)).toBeFalse();
		//....

		const joinRulePublic = await copyDepth(
			bobJoinEvent,
			await stateService.buildEvent<'m.room.join_rules'>(
				{
					type: 'm.room.join_rules',
					sender: creator,
					state_key: '',
					room_id: roomId,
					content: { join_rule: 'public' },
					...getDefaultFields(),
				},
				roomVersion,
			),
		);

		// bob allowed to be in room again
		await stateService.handlePdu(joinRulePublic);
		//
		const state3 = await stateService.getLatestRoomState2(roomId);
		expect(state3.isPublic()).toBeTrue();
		expect(state3.isUserInRoom(bob)).toBeTrue();
	});

	it('should build the correct latest state even if event is not accepted', async () => {
		const don = '@don:example.com';

		const { roomCreateEvent, roomNameEvent } = await createRoom('public', {
			[don]: 50,
		});

		const roomId = roomCreateEvent.roomId;
		const roomVersion = roomCreateEvent.version;
		const creator = roomCreateEvent.getContent().creator;

		await joinUser(roomId, don);

		// prepare a room name event
		const roomName = stripPreviousEvents(
			// auth events stay the same
			await stateService.buildEvent<'m.room.name'>(
				{
					type: 'm.room.name',
					sender: don,
					state_key: '',
					content: { name: 'new name' },
					room_id: roomId,
					...getDefaultFields(),
				},
				roomVersion,
			),
		);

		const stateResSpy = spyOn(room, 'resolveStateV2Plus');

		// two state events creating two chains
		// 1. normal join EVent
		const bob = '@bob:example.com';
		const bobJoin = await joinUser(roomId, bob);

		expect(stateResSpy).toHaveBeenCalledTimes(0);

		// 2. another normal join event but same depth
		const donBan = await copyDepth(
			bobJoin,
			await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					sender: creator,
					state_key: don,
					content: { membership: 'ban' },
					room_id: roomId,
					...getDefaultFields(),
				},
				roomVersion,
			),
		);

		await stateService.handlePdu(donBan);

		expect(stateResSpy).toHaveBeenCalledTimes(1); // soft fail check

		// stateResSpy.mockReset();

		const state1 = await stateService.getLatestRoomState2(roomId);
		expect(state1.isUserInRoom(bob)).toBeTrue();
		expect(state1.getUserMembership(don)).toBe('ban');

		// a new event that
		roomName.addPrevEvents([bobJoin, donBan]);

		expect(stateService.handlePdu(roomName)).rejects.toThrowError();

		const state2 = await stateService.getStateAtEvent(roomName);
		// must not be new name
		expect(state2.get(roomName.getUniqueStateIdentifier())).toHaveProperty(
			'eventId',
			roomNameEvent.eventId,
		);
	});

	// removing bias from own code
	it('should fetch the right state ids', async () => {
		const toEventBase = (pdu: room.Pdu) => {
			return PersistentEventFactory.createFromRawEvent(pdu, '10');
		};

		const createEvent = {
			type: 'm.room.create',
			state_key: '',
			content: {
				room_version: '10',
				creator: '@debdut:rc1.tunnel.dev.rocket.chat',
			},
			sender: '@debdut:rc1.tunnel.dev.rocket.chat',
			origin_server_ts: 1759757583361,
			room_id: '!xZbhusWZ:rc1.tunnel.dev.rocket.chat',
			prev_events: [],
			auth_events: [],
			depth: 0,
			hashes: {
				sha256: 'FIP9UiTEzoBmUJDr6wX5e2N6Xl0pg68xC8OSFXfbNac',
			},
			signatures: {
				'rc1.tunnel.dev.rocket.chat': {
					'ed25519:0':
						'lMv8+0wXgFSGRtHgBNhu8T8xkcCc6SLZfJwcLGjFIgaXAdAxMjx7HiZNv+JuDWl8qEbgdisuTkPzUTmdsgxgDQ',
				},
			},
			unsigned: {},
		} satisfies room.Pdu;

		await stateService.handlePdu(toEventBase(createEvent));

		const memberEvent = {
			type: 'm.room.member',
			content: {
				membership: 'join',
			},
			room_id: '!xZbhusWZ:rc1.tunnel.dev.rocket.chat',
			state_key: '@debdut:rc1.tunnel.dev.rocket.chat',
			auth_events: [
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
			] as EventID[],
			depth: 1,
			prev_events: [
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
			] as EventID[],
			origin_server_ts: 1759757583403,
			sender: '@debdut:rc1.tunnel.dev.rocket.chat',
			hashes: {
				sha256: 'xxHM8Wz5s70Z24XGVlQuQlP6wu4WKHKrWJkX+VZsN7Y',
			},
			signatures: {
				'rc1.tunnel.dev.rocket.chat': {
					'ed25519:0':
						'LCl4QANTD9cSDpIrXj3bv7nJxs9x7QA4y6tZl49//C3CJJiGzZUfjGG3dH11RcSD2esTNSYJwQAbKqNGiWe4Ag',
				},
			},
			unsigned: {},
		} satisfies room.Pdu;

		await stateService.handlePdu(toEventBase(memberEvent));

		const name = {
			type: 'm.room.name',
			content: {
				name: 'a',
			},
			room_id: '!xZbhusWZ:rc1.tunnel.dev.rocket.chat',
			state_key: '',
			auth_events: [
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
			] as EventID[],
			depth: 2,
			prev_events: [
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
			] as EventID[],
			origin_server_ts: 1759757583427,
			sender: '@debdut:rc1.tunnel.dev.rocket.chat',
			hashes: {
				sha256: 'kSKUQ1qEW1kMBFFT8T738BJRpgKQaZoeX9K/RcgOxx8',
			},
			signatures: {
				'rc1.tunnel.dev.rocket.chat': {
					'ed25519:0':
						'GSgPxsTF7VnbtGEGmwhH7F/Ets4R15BJpl1NjWi+SdwkVp7nvcQm/hKUNY803QlBNYur5OcLIi47DkxJ2Cg1Cw',
				},
			},
			unsigned: {},
		} satisfies room.Pdu;

		await stateService.handlePdu(toEventBase(name));

		const powerLevel = {
			type: 'm.room.power_levels',
			content: {
				users: {
					'@debdut:rc1.tunnel.dev.rocket.chat': 100,
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
			room_id: '!xZbhusWZ:rc1.tunnel.dev.rocket.chat',
			state_key: '',
			auth_events: [
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
			] as EventID[],
			depth: 3,
			prev_events: [
				'$yvGHQAk_VvuInS5WsW3_w-mi5zLSC_ZWz724wSla_z4',
			] as EventID[],
			origin_server_ts: 1759757583446,
			sender: '@debdut:rc1.tunnel.dev.rocket.chat',
			hashes: {
				sha256: 'tyTsDppTjJWviE4U2dU5SIhofkWOg1mM50m43dmJUWk',
			},
			signatures: {
				'rc1.tunnel.dev.rocket.chat': {
					'ed25519:0':
						'Tftd0/LAn8NaEcrGYb5nXp69nbSyVBNqlDuqSfq3XbAOlWSRZIiP7/Zm4RZmrdZ6zZgjvDABD+TrCiRFccxdDg',
				},
			},
			unsigned: {},
		} satisfies room.Pdu;

		await stateService.handlePdu(toEventBase(powerLevel));

		const joinRule = {
			type: 'm.room.join_rules',
			content: {
				join_rule: 'public',
			},
			room_id: '!xZbhusWZ:rc1.tunnel.dev.rocket.chat',
			state_key: '',
			auth_events: [
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
			] as EventID[],
			depth: 4,
			prev_events: [
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
			] as EventID[],
			origin_server_ts: 1759757583461,
			sender: '@debdut:rc1.tunnel.dev.rocket.chat',
			hashes: {
				sha256: 'jt3bItyFElVVoEOJWaqtNf93dzpWi4D8kx6+ApABA6c',
			},
			signatures: {
				'rc1.tunnel.dev.rocket.chat': {
					'ed25519:0':
						'4yNSSn29xebrwW2LpM+P7qGgHhpNFbmIFrvKQw7sN0qRHNaLIx7mlwiFyfm2P4gdHaiIV+6WyeueH+QtPJejAA',
				},
			},
			unsigned: {},
		} satisfies room.Pdu;

		await stateService.handlePdu(toEventBase(joinRule));

		const alias = {
			type: 'm.room.canonical_alias',
			content: {
				alias: '#a:rc1.tunnel.dev.rocket.chat',
				alt_aliases: [],
			},
			room_id: '!xZbhusWZ:rc1.tunnel.dev.rocket.chat',
			state_key: '',
			auth_events: [
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
			] as EventID[],
			depth: 5,
			prev_events: [
				'$wWJBjUdHzAds-ZjpgwLQdDKpA3lQQLPkJuQCq-yUHQc',
			] as EventID[],
			origin_server_ts: 1759757583476,
			sender: '@debdut:rc1.tunnel.dev.rocket.chat',
			hashes: {
				sha256: 'hvUo6j/yFIjhst7AJSgeMFKGtk4MuPAROKDdDv/Eb5c',
			},
			signatures: {
				'rc1.tunnel.dev.rocket.chat': {
					'ed25519:0':
						'HwCvEEM4l7HQDiHVyoNQOgsPuKR4Q7ZCfaD025XZ+rv9AG2Gu8rTGJ9Bvtq8oKSCgtqvNrPplLdk/KVow7ZXCA',
				},
			},
			unsigned: {},
		} satisfies room.Pdu;

		await stateService.handlePdu(toEventBase(alias));

		const invite = {
			type: 'm.room.member',
			content: {
				membership: 'invite',
			},
			room_id: '!xZbhusWZ:rc1.tunnel.dev.rocket.chat',
			state_key: '@ah:syn1.tunnel.dev.rocket.chat',
			auth_events: [
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
				'$wWJBjUdHzAds-ZjpgwLQdDKpA3lQQLPkJuQCq-yUHQc',
			] as EventID[],
			depth: 6,
			prev_events: [
				'$3Ttw6n2x6EALDnf4Cm5BKtYrIfzlyuE0VMmfXI2j680',
			] as EventID[],
			origin_server_ts: 1759757778902,
			sender: '@debdut:rc1.tunnel.dev.rocket.chat',
			hashes: {
				sha256: 'fcw6kOo6W9yufNeeLB9QI+WLz78ED/QvMNbSut0sXMM',
			},
			signatures: {
				'rc1.tunnel.dev.rocket.chat': {
					'ed25519:0':
						'hoNC177zwdlYHURCAsavTPVYsBJJMINeuVCsbZjFiBFuO4SEaMEmTU/5Ht0KADE/XwHCOeGg4xB9sD9L+yeWDQ',
				},
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'hpFY8m5g1e4s/0VrV8fEP3hIsvn1sh68ZfXaUrV5wpMSFwAzZaC5wW5UxwHAopUTDNfNRnR1lANti6a9ddUFBw',
				},
			},
			unsigned: {
				invite_room_state: [
					{
						content: {
							alias: '#a:rc1.tunnel.dev.rocket.chat',
							alt_aliases: [],
						},
						sender: '@debdut:rc1.tunnel.dev.rocket.chat',
						state_key: '',
						type: 'm.room.canonical_alias',
					},
					{
						content: {
							join_rule: 'public',
						},
						sender: '@debdut:rc1.tunnel.dev.rocket.chat',
						state_key: '',
						type: 'm.room.join_rules',
					},
					{
						content: {
							users: {
								'@debdut:rc1.tunnel.dev.rocket.chat': 100,
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
						sender: '@debdut:rc1.tunnel.dev.rocket.chat',
						state_key: '',
						type: 'm.room.power_levels',
					},
					{
						content: {
							name: 'a',
						},
						sender: '@debdut:rc1.tunnel.dev.rocket.chat',
						state_key: '',
						type: 'm.room.name',
					},
					{
						content: {
							membership: 'join',
						},
						sender: '@debdut:rc1.tunnel.dev.rocket.chat',
						state_key: '@debdut:rc1.tunnel.dev.rocket.chat',
						type: 'm.room.member',
					},
					{
						content: {
							room_version: '10',
							creator: '@debdut:rc1.tunnel.dev.rocket.chat',
						},
						sender: '@debdut:rc1.tunnel.dev.rocket.chat',
						state_key: '',
						type: 'm.room.create',
					},
				],
			},
		} satisfies room.Pdu;

		await stateService.handlePdu(toEventBase(invite));
		// join ecebnt
		const ahJoin = {
			type: 'm.room.member',
			content: {
				membership: 'join',
				displayname: 'ah',
				// @ts-ignore this has been fixed by rodrigo already in zod
				avatar_url: null as unknown as undefined,
			},
			sender: '@ah:syn1.tunnel.dev.rocket.chat',
			room_id: '!xZbhusWZ:rc1.tunnel.dev.rocket.chat',
			origin_server_ts: 1759757909955,
			depth: 7,
			prev_events: [
				'$Ka58p5BSdnjjmCPN22Erj6piAXRHIm9hQjXv1g5DeXw',
			] as EventID[],
			auth_events: [
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
				'$Ka58p5BSdnjjmCPN22Erj6piAXRHIm9hQjXv1g5DeXw',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
				'$wWJBjUdHzAds-ZjpgwLQdDKpA3lQQLPkJuQCq-yUHQc',
			] as EventID[],
			// @ts-ignore
			origin: 'syn1.tunnel.dev.rocket.chat',
			unsigned: {
				age: 2,
			},
			state_key: '@ah:syn1.tunnel.dev.rocket.chat',
			hashes: {
				sha256: 'Hm9e72/DXfNsXJHoS/rGhIyBuNBnp3KcCEtuukMUrUk',
			},
			signatures: {
				'rc1.tunnel.dev.rocket.chat': {
					'ed25519:0':
						'5IyCqACOVFJ9h5HGbXWNOwuNpn2hdCRpDWMgmfnH11epIjCCGKNHLftaBPdiOLTSO9RyBixEtplphmgBazWCDQ',
				},
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'c6SYtgr3UoFu3OfxjF5Da+Sk2VgEBQxK3StPxC0CzXWrVg2AUkJyqL4RfbfAhMnRm3eDRFTHLZ1+WzllFJv6BA',
				},
			},
		} satisfies room.Pdu;
		await stateService.handlePdu(toEventBase(ahJoin));
		const state = await stateService.getStateBeforeEvent(toEventBase(ahJoin));
		const pduIds = Array.from(state.values())
			.map((e) => e.eventId)
			.sort();
		const expected = {
			pdu_ids: [
				'$3Ttw6n2x6EALDnf4Cm5BKtYrIfzlyuE0VMmfXI2j680',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
				'$wWJBjUdHzAds-ZjpgwLQdDKpA3lQQLPkJuQCq-yUHQc',
				'$yvGHQAk_VvuInS5WsW3_w-mi5zLSC_ZWz724wSla_z4',
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
				'$Ka58p5BSdnjjmCPN22Erj6piAXRHIm9hQjXv1g5DeXw',
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
			].sort() as EventID[],
			auth_chain_ids: [
				'$wWJBjUdHzAds-ZjpgwLQdDKpA3lQQLPkJuQCq-yUHQc',
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
			],
		};
		expect(pduIds).toStrictEqual(expected.pdu_ids);
		const expectedAfterMessageSent = {
			pdu_ids: [
				'$3Ttw6n2x6EALDnf4Cm5BKtYrIfzlyuE0VMmfXI2j680',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
				'$wWJBjUdHzAds-ZjpgwLQdDKpA3lQQLPkJuQCq-yUHQc',
				'$yvGHQAk_VvuInS5WsW3_w-mi5zLSC_ZWz724wSla_z4',
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
				'$-C1Tf8UTaSZPEGcwVAUD1xGnKVS64HG_DxiEQVbIJBg',
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
			].sort() as EventID[],
			auth_chain_ids: [
				'$wWJBjUdHzAds-ZjpgwLQdDKpA3lQQLPkJuQCq-yUHQc',
				'$_YhqI7eEy5XRK2FEtU1QjWAStEVfDhBiKbUmVh_ML_U',
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
				'$Ka58p5BSdnjjmCPN22Erj6piAXRHIm9hQjXv1g5DeXw',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
			],
		};
		const message = {
			type: 'm.room.message',
			content: {
				body: '1',
				'm.mentions': {},
				msgtype: 'm.text',
			},
			sender: '@ah:syn1.tunnel.dev.rocket.chat',
			room_id: '!xZbhusWZ:rc1.tunnel.dev.rocket.chat',
			origin_server_ts: 1759760138291,
			depth: 8,
			prev_events: [
				'$-C1Tf8UTaSZPEGcwVAUD1xGnKVS64HG_DxiEQVbIJBg',
			] as EventID[],
			auth_events: [
				'$-C1Tf8UTaSZPEGcwVAUD1xGnKVS64HG_DxiEQVbIJBg',
				'$N6KEZQ-ClhVa9P4_MgGmtnR32zZk-W-y7IebNjdoKqI',
				'$gmoi4PDtLFJO_M4zHK0rGm-1zJePpApcfyNnXwSf5zM',
			] as EventID[],
			origin: 'syn1.tunnel.dev.rocket.chat',
			unsigned: {
				age_ts: 1759760138291,
			},
			hashes: {
				sha256: 'hmapBX++nvDz12pTvdDRzt62kuAeyMqw5h0Mta3YH/I',
			},
			signatures: {
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'enVzK6E2K5gC11j4+G5Z+8aezriR2/2P2qqWI7/S8Qhs03ON3vkj9owszdN+bPNBklGQC5YMFCKQRf+TXp+eDw',
				},
			},
		} satisfies room.Pdu;
		await stateService.handlePdu(toEventBase(message));
		const stateAfterMessage = await stateService.getStateBeforeEvent(
			toEventBase(message),
		);
		const newPduIds = Array.from(stateAfterMessage.values())
			.map((e) => e.eventId)
			.sort();
		expect(newPduIds).toStrictEqual(expectedAfterMessageSent.pdu_ids);
	});

	it('should handle concurrent joins fairly and build correct final state', async () => {
		const users = [];
		for (let i = 0; i < 20; i++) {
			users.push(`@user${i}:example.com`);
		}

		const { roomCreateEvent } = await createRoom('public');
		const roomId = roomCreateEvent.roomId;
		const version = roomCreateEvent.getContent().room_version;

		await Promise.all(users.map((u) => joinUser(roomId, u)));

		const state = await stateService.getLatestRoomState2(roomId);

		for (const user of users) {
			expect(state.isUserInRoom(user)).toBeTrue();
		}

		// all users should also be able to send a message
		for (const user of users) {
			const message = await stateService.buildEvent<'m.room.message'>(
				{
					type: 'm.room.message',
					sender: user as room.UserID,
					content: { msgtype: 'm.text', body: 'hello world' },
					room_id: roomId,
					...getDefaultFields(),
				},
				version,
			);

			await stateService.handlePdu(message);

			const event = await stateService.getEvent(message.eventId);

			expect(event?.isAuthRejected()).toBeFalse();
		}
	});
});
