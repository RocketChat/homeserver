import { beforeEach, describe, expect, it, spyOn } from 'bun:test';

import type { EventStore } from '@rocket.chat/federation-core';
import type { EventID, PduCreateEventContent, RoomVersion } from '@rocket.chat/federation-room';
import * as room from '@rocket.chat/federation-room';
import { PersistentEventFactory } from '@rocket.chat/federation-room';
import { type WithId } from 'mongodb';

import type { ConfigService } from './config.service';
import { DatabaseConnectionService } from './database-connection.service';
import type { EventAuthorizationService } from './event-authorization.service';
import type { EventEmitterService } from './event-emitter.service';
import type { EventService } from './event.service';
import type { FederationValidationService } from './federation-validation.service';
import type { FederationService } from './federation.service';
import { InviteService } from './invite.service';
import type { ProfilesService } from './profiles.service';
import { StateService } from './state.service';
import { EventRepository } from '../repositories/event.repository';
import { StateGraphRepository } from '../repositories/state-graph.repository';
import type { StateGraphStore } from '../repositories/state-graph.repository';

function getDefaultFields() {
	return {
		auth_events: [],
		prev_events: [],
		origin_server_ts: Date.now(),
		depth: 0,
	};
}

describe('InviteService', async () => {
	if (!process.env.RUN_MONGO_TESTS) {
		console.warn('Skipping tests that require a database');
		return;
	}

	const localServerName = 'local.server.com';

	const databaseConfig = {
		uri: process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true',
		name: 'matrix_test',
		poolSize: 100,
	};

	const configServiceInstance = {
		getSigningKey: async () => {
			/* noop */
		},
		serverName: localServerName,
		getConfig: (key: string) => {
			if (key === 'invite') {
				return { allowedEncryptedRooms: true, allowedNonPrivateRooms: true };
			}
			return {};
		},
	} as unknown as ConfigService;

	const database = new DatabaseConnectionService(databaseConfig);

	const eventCollection = (await database.getDb()).collection<WithId<EventStore>>('events_test');
	const stateGraphCollection = (await database.getDb()).collection<StateGraphStore>('state_graph_test');

	const eventRepository = new EventRepository(eventCollection);
	const stateGraphRepository = new StateGraphRepository(stateGraphCollection);

	const stateService = new StateService(stateGraphRepository, eventRepository, configServiceInstance, {
		notify: () => Promise.resolve(),
	} as unknown as EventService);

	const emitterService = {
		emit: () => Promise.resolve(),
	} as unknown as EventEmitterService;

	const eventAuthorizationService = {
		checkAclForInvite: () => Promise.resolve(),
	} as unknown as EventAuthorizationService;

	const federationService = {
		inviteUser: () => Promise.resolve(),
		sendEventToAllServersInRoom: () => Promise.resolve(),
	} as unknown as FederationService;

	const federationValidationService = {
		validateOutboundInvite: () => Promise.resolve(),
	} as unknown as FederationValidationService;

	const profilesService = {
		queryProfile: () => Promise.resolve(undefined),
	} as unknown as ProfilesService;

	const inviteService = new InviteService(
		federationService,
		stateService,
		configServiceInstance,
		eventAuthorizationService,
		emitterService,
		eventRepository,
		federationValidationService,
		profilesService,
	);

	beforeEach(async () => {
		await Promise.all([eventCollection.deleteMany({}), stateGraphCollection.deleteMany({})]);
	});

	const createRoom = async (joinRule: 'public' | 'invite', creator: room.UserID = '@alice:remote.server.com' as room.UserID) => {
		const roomCreateEvent = PersistentEventFactory.newCreateEvent(creator, PersistentEventFactory.defaultRoomVersion);
		await stateService.handlePdu(roomCreateEvent);

		const roomVersion: RoomVersion = roomCreateEvent.getContent<PduCreateEventContent>().room_version;

		const creatorMembershipEvent = await stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				room_id: roomCreateEvent.roomId,
				sender: creator,
				state_key: creator,
				content: { membership: 'join' },
				...getDefaultFields(),
			},
			roomVersion,
		);
		await stateService.handlePdu(creatorMembershipEvent);

		const powerLevelEvent = await stateService.buildEvent<'m.room.power_levels'>(
			{
				type: 'm.room.power_levels',
				room_id: roomCreateEvent.roomId,
				sender: creator,
				state_key: '',
				content: {
					users: { [creator]: 100 },
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
				sender: creator,
				content: { join_rule: joinRule },
				type: 'm.room.join_rules',
				state_key: '',
				...getDefaultFields(),
			},
			roomVersion,
		);
		await stateService.handlePdu(joinRuleEvent);

		return { roomCreateEvent, roomVersion, creator };
	};

	const setUserMembership = async (
		roomId: string,
		userId: string,
		membership: room.PduMembershipEventContent['membership'],
		sender?: string,
	) => {
		const roomVersion = await stateService.getRoomVersion(roomId);
		const membershipEvent = await stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				room_id: roomId as room.RoomID,
				sender: (sender || userId) as room.UserID,
				state_key: userId as room.UserID,
				content: { membership },
				...getDefaultFields(),
			},
			roomVersion,
		);
		await stateService.handlePdu(membershipEvent);
		return membershipEvent;
	};

	const joinUser = (roomId: string, userId: string) => setUserMembership(roomId, userId, 'join');
	const leaveUser = (roomId: string, userId: string) => setUserMembership(roomId, userId, 'leave');
	const inviteUser = (roomId: string, userId: string, sender: string) => setUserMembership(roomId, userId, 'invite', sender);

	describe('processInitialState - re-join after leave', () => {
		it('should only notify for new events, not re-emit already known events', async () => {
			const remoteCreator = '@alice:remote.server.com' as room.UserID;
			const localUser = `@johnny:${localServerName}` as room.UserID;

			// 1. Create room and have user join then leave
			const { roomCreateEvent, roomVersion } = await createRoom('invite', remoteCreator);
			const { roomId } = roomCreateEvent;
			await inviteUser(roomId, localUser, remoteCreator);
			await joinUser(roomId, localUser);
			await leaveUser(roomId, localUser);

			// 2. Simulate re-invite from remote server (happens on the remote side before send_join)
			const reInviteEvent = await inviteUser(roomId, localUser, remoteCreator);

			// 3. Track notify calls
			const notifyCalls: Array<{ eventId: string; type: string }> = [];
			const notifySpy = spyOn(stateService.eventService as any, 'notify').mockImplementation(
				async (event: { eventId: string; event: { type: string } }) => {
					notifyCalls.push({ eventId: event.eventId, type: event.event.type });
				},
			);

			// 4. Build state from send_join with a new join event
			const existingState = await stateService.getLatestRoomState(roomId);
			const createPdu = existingState.get('m.room.create:')!;
			const powerLevelsPdu = existingState.get('m.room.power_levels:')!;
			const joinRulesPdu = existingState.get('m.room.join_rules:')!;
			const creatorMemberPdu = existingState.get(`m.room.member:${remoteCreator}`)!;

			const rejoinEvent = await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					room_id: roomId,
					sender: localUser,
					state_key: localUser,
					content: { membership: 'join' },
					...getDefaultFields(),
				},
				roomVersion,
			);

			const statePdus = [powerLevelsPdu.event, joinRulesPdu.event, creatorMemberPdu.event, rejoinEvent.event];

			const authChain = [createPdu.event, creatorMemberPdu.event, powerLevelsPdu.event, joinRulesPdu.event, reInviteEvent.event];

			// 5. Call processInitialState on the EXISTING room
			await stateService.processInitialState(statePdus, authChain);

			// 6. Only the new join event should be notified — NOT the already-known events
			// (create, power_levels, join_rules, creator membership, invite, leave, re-invite)
			expect(notifyCalls.length).toBe(1);
			expect(notifyCalls[0].eventId).toBe(rejoinEvent.eventId);
			expect(notifyCalls[0].type).toBe('m.room.member');

			notifySpy.mockRestore();
		});

		it('should update room state correctly when processInitialState is called on re-join', async () => {
			const remoteCreator = '@alice:remote.server.com' as room.UserID;
			const localUser = `@johnny:${localServerName}` as room.UserID;

			// 1. Create room, user joins and leaves
			const { roomCreateEvent, roomVersion } = await createRoom('invite', remoteCreator);
			const { roomId } = roomCreateEvent;
			await inviteUser(roomId, localUser, remoteCreator);
			await joinUser(roomId, localUser);
			await leaveUser(roomId, localUser);

			// Verify user is not in room
			const stateAfterLeave = await stateService.getLatestRoomState2(roomId);
			expect(stateAfterLeave.isUserInRoom(localUser)).toBe(false);

			// 2. Simulate re-invite (happens on remote before send_join)
			const reInviteEvent = await inviteUser(roomId, localUser, remoteCreator);

			// 3. Build state as if from send_join (simulating re-join)
			const existingState = await stateService.getLatestRoomState(roomId);
			const createPdu = existingState.get('m.room.create:')!;
			const powerLevelsPdu = existingState.get('m.room.power_levels:')!;
			const joinRulesPdu = existingState.get('m.room.join_rules:')!;
			const creatorMemberPdu = existingState.get(`m.room.member:${remoteCreator}`)!;

			const rejoinEvent = await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					room_id: roomId,
					sender: localUser,
					state_key: localUser,
					content: { membership: 'join' },
					...getDefaultFields(),
				},
				roomVersion,
			);

			const statePdus = [powerLevelsPdu.event, joinRulesPdu.event, creatorMemberPdu.event, rejoinEvent.event];

			const authChain = [createPdu.event, creatorMemberPdu.event, powerLevelsPdu.event, joinRulesPdu.event, reInviteEvent.event];

			// 4. Call processInitialState on existing room
			await stateService.processInitialState(statePdus, authChain);

			// 5. Verify the join event is now stored in the DB
			const storedJoinEvent = await eventRepository.findById(rejoinEvent.eventId);
			expect(storedJoinEvent).not.toBeNull();
			expect(storedJoinEvent!.event.type).toBe('m.room.member');
			expect(storedJoinEvent!.event.content.membership).toBe('join');
		});
		it('should notify all events including m.room.create on first-time join (fresh room)', async () => {
			const remoteCreator = '@alice:remote.server.com' as room.UserID;
			const localUser = `@johnny:${localServerName}` as room.UserID;

			// 1. Build room state PDUs manually (simulating what send_join returns on first join)
			const roomVersion = PersistentEventFactory.defaultRoomVersion;
			const roomCreateEvent = PersistentEventFactory.newCreateEvent(remoteCreator, roomVersion);

			const creatorMemberEvent = PersistentEventFactory.createFromRawEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					room_id: roomCreateEvent.roomId,
					sender: remoteCreator,
					state_key: remoteCreator,
					content: { membership: 'join' },
					auth_events: [roomCreateEvent.eventId],
					prev_events: [roomCreateEvent.eventId],
					origin_server_ts: Date.now(),
					depth: 1,
				},
				roomVersion,
			);

			const powerLevelEvent = PersistentEventFactory.createFromRawEvent<'m.room.power_levels'>(
				{
					type: 'm.room.power_levels',
					room_id: roomCreateEvent.roomId,
					sender: remoteCreator,
					state_key: '',
					content: {
						users: { [remoteCreator]: 100 },
						users_default: 0,
						events: {},
						events_default: 0,
						state_default: 50,
						ban: 50,
						kick: 50,
						redact: 50,
						invite: 50,
					},
					auth_events: [roomCreateEvent.eventId, creatorMemberEvent.eventId],
					prev_events: [creatorMemberEvent.eventId],
					origin_server_ts: Date.now(),
					depth: 2,
				},
				roomVersion,
			);

			const joinRuleEvent = PersistentEventFactory.createFromRawEvent<'m.room.join_rules'>(
				{
					type: 'm.room.join_rules',
					room_id: roomCreateEvent.roomId,
					sender: remoteCreator,
					state_key: '',
					content: { join_rule: 'invite' },
					auth_events: [roomCreateEvent.eventId, creatorMemberEvent.eventId, powerLevelEvent.eventId],
					prev_events: [powerLevelEvent.eventId],
					origin_server_ts: Date.now(),
					depth: 3,
				},
				roomVersion,
			);

			const inviteEvent = PersistentEventFactory.createFromRawEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					room_id: roomCreateEvent.roomId,
					sender: remoteCreator,
					state_key: localUser,
					content: { membership: 'invite' },
					auth_events: [roomCreateEvent.eventId, creatorMemberEvent.eventId, powerLevelEvent.eventId, joinRuleEvent.eventId],
					prev_events: [joinRuleEvent.eventId],
					origin_server_ts: Date.now(),
					depth: 4,
				},
				roomVersion,
			);

			// 2. Track notify calls
			const notifyCalls: Array<{ eventId: string; type: string }> = [];
			const notifySpy = spyOn(stateService.eventService as any, 'notify').mockImplementation(
				async (event: { eventId: string; event: { type: string } }) => {
					notifyCalls.push({ eventId: event.eventId, type: event.event.type });
				},
			);

			// 3. Call processInitialState on a FRESH room (no prior state)
			const statePdus = [creatorMemberEvent.event, powerLevelEvent.event, joinRuleEvent.event, inviteEvent.event];
			const authChain = [roomCreateEvent.event, creatorMemberEvent.event, powerLevelEvent.event, joinRuleEvent.event];

			await stateService.processInitialState(statePdus, authChain);

			// 4. ALL events should be notified, including m.room.create
			const notifiedTypes = notifyCalls.map((c) => c.type);
			expect(notifiedTypes).toContain('m.room.create');
			expect(notifiedTypes).toContain('m.room.member');
			expect(notifiedTypes).toContain('m.room.power_levels');
			expect(notifiedTypes).toContain('m.room.join_rules');

			// The create event specifically must be notified
			const createNotification = notifyCalls.find((c) => c.eventId === roomCreateEvent.eventId);
			expect(createNotification).toBeDefined();
			expect(createNotification!.type).toBe('m.room.create');

			notifySpy.mockRestore();
		});
	});

	describe('processInvite - re-invite after leave', () => {
		it('should store invite as outlier when prev_events reference unknown events (re-invite after leave)', async () => {
			const remoteServer = 'remote.server.com';
			const remoteCreator = `@alice:${remoteServer}` as room.UserID;
			const localUser = `@johnny:${localServerName}` as room.UserID;

			// 1. Set up room on "remote" server (simulated locally for test)
			const { roomCreateEvent, roomVersion } = await createRoom('invite', remoteCreator);
			const { roomId } = roomCreateEvent;

			// 2. Invite local user, join, then leave
			await inviteUser(roomId, localUser, remoteCreator);
			await joinUser(roomId, localUser);
			await leaveUser(roomId, localUser);

			// Verify user has left
			const stateAfterLeave = await stateService.getLatestRoomState2(roomId);
			expect(stateAfterLeave.isUserInRoom(localUser)).toBe(false);

			// 3. Simulate messages sent on the remote server that we never receive
			// (these events exist on the remote server but not locally)
			const unknownEventId1 = '$unknown-event-1:remote.server.com' as EventID;
			const unknownEventId2 = '$unknown-event-2:remote.server.com' as EventID;

			// 4. Simulate a re-invite from the remote server
			// The invite's prev_events reference events we never received
			const latestEvents = await eventRepository.findLatestEvents(roomId);
			const latestAuthEvents = latestEvents.map((e) => e._id);

			const reInviteEvent = {
				type: 'm.room.member' as const,
				content: { membership: 'invite' as const },
				room_id: roomId,
				state_key: localUser,
				sender: remoteCreator,
				auth_events: latestAuthEvents,
				prev_events: [unknownEventId1, unknownEventId2],
				depth: 100,
				origin_server_ts: Date.now(),
				unsigned: {},
			} as room.Pdu;

			const reInviteEventId = PersistentEventFactory.createFromRawEvent(reInviteEvent, roomVersion).eventId;

			// 5. Process the re-invite - this should NOT throw
			const result = await inviteService.processInvite(reInviteEvent as any, reInviteEventId, roomVersion, [
				{
					content: { join_rule: 'invite' },
					sender: remoteCreator,
					state_key: '',
					type: 'm.room.join_rules',
				},
			] as any);

			expect(result).toBeDefined();
			expect(result.eventId).toBe(reInviteEventId);

			// 6. Verify the event was stored as an outlier
			const storedEvent = await eventRepository.findById(reInviteEventId);
			expect(storedEvent).not.toBeNull();
			expect(storedEvent!.outlier).toBe(true);
			expect(storedEvent!.stateId).toBe('');
		});

		it('should use handlePdu when prev_events are known locally (normal invite flow)', async () => {
			const remoteServer = 'remote.server.com';
			const remoteCreator = `@alice:${remoteServer}` as room.UserID;
			const localUser = `@johnny:${localServerName}` as room.UserID;

			// 1. Set up room
			const { roomCreateEvent, roomVersion } = await createRoom('invite', remoteCreator);
			const { roomId } = roomCreateEvent;

			// 2. Use buildEvent + handlePdu via the existing helper (which properly sets auth_events and prev_events)
			// This is the "normal" invite flow where the room host invites a local user
			await inviteUser(roomId, localUser, remoteCreator);

			// 3. Verify the invite is reflected in room state (processed via handlePdu)
			const state = await stateService.getLatestRoomState2(roomId);
			expect(state.isUserInvited(localUser)).toBeTrue();
		});

		it('should store as outlier when room has no create event', async () => {
			const remoteServer = 'remote.server.com';
			const remoteCreator = `@alice:${remoteServer}` as room.UserID;
			const localUser = `@johnny:${localServerName}` as room.UserID;
			const unknownRoomId = '!unknown-room:remote.server.com' as room.RoomID;

			const inviteEventRaw = {
				type: 'm.room.member' as const,
				content: { membership: 'invite' as const },
				room_id: unknownRoomId,
				state_key: localUser,
				sender: remoteCreator,
				auth_events: [],
				prev_events: ['$some-event:remote.server.com' as EventID],
				depth: 5,
				origin_server_ts: Date.now(),
				unsigned: {},
			} as room.Pdu;

			const inviteEventInstance = PersistentEventFactory.createFromRawEvent(inviteEventRaw, '10');

			const result = await inviteService.processInvite(inviteEventRaw as any, inviteEventInstance.eventId, '10', [
				{
					content: { join_rule: 'invite' },
					sender: remoteCreator,
					state_key: '',
					type: 'm.room.join_rules',
				},
			] as any);

			expect(result).toBeDefined();

			// Verify stored as outlier
			const storedEvent = await eventRepository.findById(inviteEventInstance.eventId);
			expect(storedEvent).not.toBeNull();
			expect(storedEvent!.outlier).toBe(true);
		});

		it('should handle a full invite-join-leave-reinvite cycle without errors', async () => {
			const remoteServer = 'remote.server.com';
			const remoteCreator = `@alice:${remoteServer}` as room.UserID;
			const localUser = `@johnny:${localServerName}` as room.UserID;

			// 1. Set up room and do the full cycle
			const { roomCreateEvent, roomVersion } = await createRoom('invite', remoteCreator);
			const { roomId } = roomCreateEvent;

			// Step 1: Invite
			const firstInvite = await inviteUser(roomId, localUser, remoteCreator);
			const state1 = await stateService.getLatestRoomState2(roomId);
			expect(state1.isUserInvited(localUser)).toBeTrue();

			// Step 2: Join
			await joinUser(roomId, localUser);
			const state2 = await stateService.getLatestRoomState2(roomId);
			expect(state2.isUserInRoom(localUser)).toBeTrue();

			// Step 3: Send messages while user is in the room
			const msgEvent = await stateService.buildEvent<'m.room.message'>(
				{
					type: 'm.room.message',
					room_id: roomId,
					sender: localUser,
					content: { body: 'hello', msgtype: 'm.text' },
					...getDefaultFields(),
				},
				roomVersion,
			);
			await stateService.handlePdu(msgEvent);

			// Step 4: User leaves
			await leaveUser(roomId, localUser);
			const state3 = await stateService.getLatestRoomState2(roomId);
			expect(state3.isUserInRoom(localUser)).toBe(false);

			// Step 5: Simulate remote server activity we don't receive
			// (after leave, the remote server stops sending us events)
			// These events have prev_events pointing to events we don't have
			const unknownPrevEvent = '$post-leave-msg:remote.server.com' as EventID;

			// Step 6: Re-invite from remote server with unknown prev_events
			const reInviteEventRaw = {
				type: 'm.room.member' as const,
				content: { membership: 'invite' as const },
				room_id: roomId,
				state_key: localUser,
				sender: remoteCreator,
				auth_events: [roomCreateEvent.eventId],
				prev_events: [unknownPrevEvent],
				depth: 200,
				origin_server_ts: Date.now(),
				unsigned: {},
			} as room.Pdu;

			const reInviteEventInstance = PersistentEventFactory.createFromRawEvent(reInviteEventRaw, roomVersion);

			// This should NOT throw "no previous state for event"
			const result = await inviteService.processInvite(reInviteEventRaw as any, reInviteEventInstance.eventId, roomVersion, [
				{
					content: { join_rule: 'invite' },
					sender: remoteCreator,
					state_key: '',
					type: 'm.room.join_rules',
				},
			] as any);

			expect(result).toBeDefined();

			// Verify stored as outlier since prev_events are unknown
			const storedEvent = await eventRepository.findById(reInviteEventInstance.eventId);
			expect(storedEvent).not.toBeNull();
			expect(storedEvent!.outlier).toBe(true);
		});
	});
});
