import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';

import { ForbiddenError } from '@rocket.chat/federation-core';
import {
	type EventID,
	type Pdu,
	type PduJoinRuleEventContent,
	type PduPowerLevelsEventContent,
	type PersistentEventBase,
	PersistentEventFactory,
	type RoomID,
	type RoomVersion,
	type StateMapKey,
	type UserID,
} from '@rocket.chat/federation-room';
import type { Collection } from 'mongodb';
import { container } from 'tsyringe';

import { EventRejectedError, FederationValidationService, federationSDK, init } from '..';
import { AppConfig, ConfigService } from './config.service';
import { EventService } from './event.service';
import { FederationSenderService } from './federation-sender.service';
import { FederationService } from './federation.service';
import { RoomService } from './room.service';
import { StateService } from './state.service';
import { NEW_SERVER_CATCH_UP_DELAY_MS, StickyEventService } from './sticky-event.service';
import { StagingAreaQueue } from '../queues/staging-area.queue';
import { EventRepository } from '../repositories/event.repository';
import { LOCK_KEEP_ALIVE_INTERVAL_MS, LOCK_TIMEOUT_MS, type Lock, LockRepository } from '../repositories/lock.repository';

describe('RoomService', async () => {
	if (!process.env.RUN_MONGO_TESTS) {
		console.warn('Skipping tests that require a database');
		return;
	}

	beforeAll(async () => {
		const databaseConfig = {
			uri: process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true',
			name: 'matrix_test',
			poolSize: 100,
		};

		await init({
			dbConfig: databaseConfig,
		});

		federationSDK.setConfig({
			signingKey: '',
			serverName: 'example.com',
			enableStickyEvents: true,
		} as AppConfig);
	});

	const configService = new ConfigService();

	container.register(ConfigService, {
		useValue: configService,
	});

	// dont validate anything during tests
	container.register(FederationValidationService, {
		useValue: {
			async validateOutboundUser() {
				return true;
			},
			async validateOutboundInvite() {
				return true;
			},
		} as unknown as FederationValidationService,
	});

	const stateService = container.resolve(StateService);
	const roomService = container.resolve(RoomService);

	const createRoom = async (
		username: UserID,
		joinRule: PduJoinRuleEventContent['join_rule'],
		{
			users = {},
			events = {},
		}: {
			users?: PduPowerLevelsEventContent['users'];
			events?: PduPowerLevelsEventContent['events'];
		} = {
			users: {},
			events: {},
		},
	) => {
		const result = await federationSDK.createRoom(username, 'Test Room', joinRule, {
			users,
			events,
		});

		const state = await stateService.getLatestRoomState(result.room_id);

		const memberKey = [...state.keys()].find((stateKey) => stateKey.includes('m.room.member:')) as `m.room.member:${string}`;

		const roomCreateEvent = state.get('m.room.create:');
		const joinRuleEvent = state.get('m.room.join_rules:');
		const powerLevelEvent = state.get('m.room.power_levels:');
		const creatorMembershipEvent = state.get(memberKey);
		const roomNameEvent = state.get('m.room.name:');

		if (!roomCreateEvent || !joinRuleEvent || !powerLevelEvent || !creatorMembershipEvent || !roomNameEvent) {
			throw new Error('Event not found');
		}

		return {
			roomCreateEvent,
			joinRuleEvent,
			powerLevelEvent,
			creatorMembershipEvent,
			roomNameEvent,
		} as {
			roomCreateEvent: PersistentEventBase<RoomVersion, 'm.room.create'>;
			joinRuleEvent: PersistentEventBase<RoomVersion, 'm.room.join_rules'>;
			powerLevelEvent: PersistentEventBase<RoomVersion, 'm.room.power_levels'>;
			creatorMembershipEvent: PersistentEventBase<RoomVersion, 'm.room.member'>;
			roomNameEvent: PersistentEventBase<RoomVersion, 'm.room.name'>;
		};
	};

	describe('createRoom', () => {
		it('should create room correctly', async () => {
			const username = '@alice:example.com' as UserID;
			const { roomCreateEvent, roomNameEvent, joinRuleEvent, powerLevelEvent, creatorMembershipEvent } = await createRoom(
				username,
				'public',
			);

			const { roomId } = roomCreateEvent;

			const state = await stateService.getLatestRoomState(roomId);

			// check each event
			expect(state.get(roomCreateEvent.getUniqueStateIdentifier())).toHaveProperty('eventId', roomCreateEvent.eventId);
			expect(state.get(roomNameEvent.getUniqueStateIdentifier())).toHaveProperty('eventId', roomNameEvent.eventId);
			expect(state.get(joinRuleEvent.getUniqueStateIdentifier())).toHaveProperty('eventId', joinRuleEvent.eventId);
			expect(state.get(powerLevelEvent.getUniqueStateIdentifier())).toHaveProperty('eventId', powerLevelEvent.eventId);
			expect(state.get(creatorMembershipEvent.getUniqueStateIdentifier())).toHaveProperty('eventId', creatorMembershipEvent.eventId);

			expect([...state.keys()]).toEqual(
				expect.arrayContaining([
					'm.room.canonical_alias:',
					'm.room.create:',
					'm.room.name:',
					'm.room.join_rules:',
					'm.room.power_levels:',
					`m.room.member:${username}`,
				]),
			);
		});

		it('should always keep the owner as 100', async () => {
			const username = '@alice:example.com' as UserID;
			const { powerLevelEvent } = await createRoom(username, 'public', {
				users: { '@alice:example.com': 10 },
			});

			expect(powerLevelEvent.getContent().users[username]).toBe(100);
		});

		it('should accept custom event powers', async () => {
			const username = '@alice:example.com' as UserID;
			const { powerLevelEvent } = await createRoom(username, 'public', {
				events: { 'rc.room.name': 10 },
			});
			expect(powerLevelEvent.getContent().events['rc.room.name']).toBe(10);
		});

		it('should let any member publish their call membership by default', async () => {
			const username = '@alice:example.com' as UserID;
			const { powerLevelEvent } = await createRoom(username, 'public');

			expect(powerLevelEvent.getContent().events['org.matrix.msc3401.call.member']).toBe(0);
		});

		it('should let custom event powers override the default ones', async () => {
			const username = '@alice:example.com' as UserID;
			const { powerLevelEvent } = await createRoom(username, 'public', {
				events: { 'org.matrix.msc3401.call.member': 50 },
			});

			expect(powerLevelEvent.getContent().events['org.matrix.msc3401.call.member']).toBe(50);
		});

		it('should let any member of a direct message publish their call membership', async () => {
			const roomId = await federationSDK.createDirectMessage({
				creatorUserId: '@alice:example.com' as UserID,
				members: ['@bob:example.com' as UserID],
			});

			const state = await stateService.getLatestRoomState(roomId);

			expect(state.get('m.room.power_levels:')?.getContent().events['org.matrix.msc3401.call.member']).toBe(0);
		});

		it.skip('should create direct message room correctly', async () => {
			const username = '@alice:example.com' as UserID;
			const targetUsername = '@bob:example.com' as UserID;

			const roomId = await federationSDK.createDirectMessageRoom(username, targetUsername);

			const state = await stateService.getLatestRoomState(roomId);

			expect(state.size).toBe(2);

			expect([...state.keys()]).toEqual(
				expect.arrayContaining(['m.room.create:', `m.room.member:${targetUsername}`, `m.room.member:${username}`]),
			);
		});
	});

	describe('joinUser', () => {
		it('should join user to room correctly', async () => {
			const username = '@alice:example.com' as UserID;
			const secondaryUsername = '@bob:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'public');

			const { roomId } = roomCreateEvent;

			const initialState = await stateService.getLatestRoomState(roomId);

			const imtialStateKeys = [...initialState.keys()].sort();

			const expectedStateKeys = [
				'm.room.create:',
				`m.room.member:${username}`,
				'm.room.join_rules:',
				'm.room.power_levels:',
				'm.room.name:',
				'm.room.canonical_alias:',
			].sort() as StateMapKey[];

			expect(imtialStateKeys).toEqual(expectedStateKeys);

			await roomService.joinUser(roomId, secondaryUsername);

			const state = await stateService.getLatestRoomState(roomId);

			expect([...state.keys()]).toEqual(
				expect.arrayContaining(['m.room.create:', `m.room.member:${username}`, `m.room.member:${secondaryUsername}`]),
			);
		});
	});

	describe('leaveRoom', () => {
		it('should leave user from room correctly', async () => {
			const username = '@alice:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'public');

			const { roomId } = roomCreateEvent;

			await federationSDK.leaveRoom(roomId, username);

			const state = await stateService.getLatestRoomState(roomId);

			expect([...state.keys()]).toEqual(expect.arrayContaining(['m.room.create:', `m.room.member:${username}`]));

			const userState = state.get(`m.room.member:${username}`) as PersistentEventBase<RoomVersion, 'm.room.member'>;

			expect(userState?.getContent().membership).toBe('leave');
		});
	});

	describe('kickUser', () => {
		it('should ban user to room correctly', async () => {
			const username = '@alice:example.com' as UserID;
			const secondaryUsername = '@bob:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'public');

			const { roomId } = roomCreateEvent;

			await federationSDK.kickUser(roomId, secondaryUsername, username);

			const state = await stateService.getLatestRoomState(roomId);

			expect([...state.keys()]).toEqual(
				expect.arrayContaining(['m.room.create:', `m.room.member:${username}`, `m.room.member:${secondaryUsername}`]),
			);

			const secondaryState = state.get(`m.room.member:${secondaryUsername}`) as PersistentEventBase<RoomVersion, 'm.room.member'>;

			expect(secondaryState?.getContent().membership).toBe('leave');
		});
	});

	describe('banUser', () => {
		it('should ban user to room correctly', async () => {
			const username = '@alice:example.com' as UserID;
			const secondaryUsername = '@bob:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'public');

			const { roomId } = roomCreateEvent;
			await federationSDK.banUser(roomId, secondaryUsername, username);

			const state = await stateService.getLatestRoomState(roomId);

			expect([...state.keys()]).toEqual(
				expect.arrayContaining(['m.room.create:', `m.room.member:${username}`, `m.room.member:${secondaryUsername}`]),
			);

			const secondaryState = state.get(`m.room.member:${secondaryUsername}`) as PersistentEventBase<RoomVersion, 'm.room.member'>;

			expect(secondaryState?.getContent().membership).toBe('ban');
		});
	});

	describe('updateUserPowerLevel', () => {
		it('should update user power level correctly', async () => {
			const username = '@alice:example.com' as UserID;
			const secondaryUsername = '@bob:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'public');

			const { roomId } = roomCreateEvent;

			await roomService.joinUser(roomId, username, secondaryUsername);

			expect(
				await stateService.getLatestRoomState(roomId).then((state) => {
					return state.get('m.room.power_levels:')!.getContent();
				}),
			).toHaveProperty('users', {
				[username]: 100,
			});

			await federationSDK.updateUserPowerLevel(roomId, secondaryUsername, 50, username);

			expect(
				await stateService.getLatestRoomState(roomId).then((state) => {
					return state.get('m.room.power_levels:')!.getContent();
				}),
			).toHaveProperty('users', {
				[username]: 100,
				[secondaryUsername]: 50,
			});
		});

		it('builds each update on the current power levels', async () => {
			const alice = '@alice:example.com' as UserID;
			const bob = '@bob:example.com' as UserID;
			const carol = '@carol:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(alice, 'public');
			const { roomId } = roomCreateEvent;

			await roomService.joinUser(roomId, alice, bob);
			await roomService.joinUser(roomId, alice, carol);

			await federationSDK.updateUserPowerLevel(roomId, bob, 50, alice);
			await federationSDK.updateUserPowerLevel(roomId, carol, 25, alice);

			const state = await stateService.getLatestRoomState(roomId);
			expect(state.get('m.room.power_levels:')!.getContent()).toHaveProperty('users', {
				[alice]: 100,
				[bob]: 50,
				[carol]: 25,
			});
		});
	});

	describe('acceptInvite', () => {
		it('should accept invite and join user to room correctly', async () => {
			const username = '@alice:example.com' as UserID;
			const invitedUsername = '@bob:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'invite');
			const { roomId } = roomCreateEvent;

			await federationSDK.inviteUserToRoom(invitedUsername, roomId, username);

			const stateBeforeAccept = await stateService.getLatestRoomState(roomId);
			const inviteMemberEvent = stateBeforeAccept.get(`m.room.member:${invitedUsername}`) as
				| PersistentEventBase<RoomVersion, 'm.room.member'>
				| undefined;

			expect(inviteMemberEvent?.getContent().membership).toBe('invite');

			await federationSDK.acceptInvite(roomId, invitedUsername);

			const stateAfterAccept = await stateService.getLatestRoomState(roomId);
			const joinMemberEvent = stateAfterAccept.get(`m.room.member:${invitedUsername}`) as PersistentEventBase<RoomVersion, 'm.room.member'>;

			expect(joinMemberEvent.getContent().membership).toBe('join');
			expect([...stateAfterAccept.keys()]).toEqual(
				expect.arrayContaining(['m.room.create:', `m.room.member:${username}`, `m.room.member:${invitedUsername}`]),
			);
		});
	});

	describe('rejectInvite', () => {
		it('should reject invite and leave room correctly', async () => {
			const username = '@alice:example.com' as UserID;
			const invitedUsername = '@bob:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'invite');
			const { roomId } = roomCreateEvent;

			await federationSDK.inviteUserToRoom(invitedUsername, roomId, username);

			const stateBeforeReject = await stateService.getLatestRoomState(roomId);
			const inviteMemberEvent = stateBeforeReject.get(`m.room.member:${invitedUsername}`) as
				| PersistentEventBase<RoomVersion, 'm.room.member'>
				| undefined;

			expect(inviteMemberEvent?.getContent().membership).toBe('invite');

			await federationSDK.rejectInvite(roomId, invitedUsername);

			const stateAfterReject = await stateService.getLatestRoomState(roomId);
			const leaveMemberEvent = stateAfterReject.get(`m.room.member:${invitedUsername}`) as PersistentEventBase<
				RoomVersion,
				'm.room.member'
			>;

			expect(leaveMemberEvent.getContent().membership).toBe('leave');
			expect([...stateAfterReject.keys()]).toEqual(
				expect.arrayContaining(['m.room.create:', `m.room.member:${username}`, `m.room.member:${invitedUsername}`]),
			);
		});
	});

	describe('sendLeave', () => {
		const alice = '@alice:example.com' as UserID;
		const carol = '@carol:remote.com' as UserID;

		const federationService = container.resolve(FederationService);

		afterEach(() => {
			mock.restore();
		});

		const createRoomWithRemoteInvite = async () => {
			spyOn(federationService, 'inviteUser').mockImplementation(async (inviteEvent) => ({ event: inviteEvent.event }) as any);
			spyOn(federationService, 'sendEventToAllServersInRoom').mockResolvedValue();

			const { roomCreateEvent } = await createRoom(alice, 'invite');
			await federationSDK.inviteUserToRoom(carol, roomCreateEvent.roomId, alice);

			return roomCreateEvent.roomId;
		};

		it('accepts an invite rejection when the room was created on another server', async () => {
			const roomId = await createRoomWithRemoteInvite();
			spyOn(stateService, 'getRoomOriginServer').mockResolvedValue('creator.com');

			const { event, room_version } = await roomService.makeLeave(roomId, carol, 'remote.com');
			const leaveEvent = PersistentEventFactory.createFromRawEvent<'m.room.member'>(event, room_version);

			await roomService.sendLeave(roomId, leaveEvent.eventId, leaveEvent.event, 'remote.com');

			const state = await stateService.getLatestRoomState(roomId);
			expect(state.get(`m.room.member:${carol}`)?.getContent().membership).toBe('leave');
		});

		it('refuses a leave when no local user is joined to the room', async () => {
			const roomId = await createRoomWithRemoteInvite();
			await roomService.leaveRoom(roomId, alice);

			const { event, room_version } = await roomService.makeLeave(roomId, carol, 'remote.com');
			const leaveEvent = PersistentEventFactory.createFromRawEvent<'m.room.member'>(event, room_version);

			await expect(roomService.sendLeave(roomId, leaveEvent.eventId, leaveEvent.event, 'remote.com')).rejects.toThrow(
				'is not resident in room',
			);
		});

		it('refuses a leave whose sender does not belong to the requesting server', async () => {
			const roomId = await createRoomWithRemoteInvite();

			const { event, room_version } = await roomService.makeLeave(roomId, alice, 'example.com');
			const leaveEvent = PersistentEventFactory.createFromRawEvent<'m.room.member'>(event, room_version);

			await expect(roomService.sendLeave(roomId, leaveEvent.eventId, leaveEvent.event, 'remote.com')).rejects.toThrow(ForbiddenError);

			const state = await stateService.getLatestRoomState(roomId);
			expect(state.get(`m.room.member:${alice}`)?.getContent().membership).toBe('join');
		});

		it('refuses to build a leave for a user of another server', async () => {
			const roomId = await createRoomWithRemoteInvite();

			await expect(roomService.makeLeave(roomId, alice, 'remote.com')).rejects.toThrow(ForbiddenError);
		});
	});

	describe('joinUser - remote room', () => {
		const remoteRoomId = '!remote-room:remote.com' as RoomID;
		const bob = '@bob:example.com' as UserID;
		const stagingInstance = 'staging-instance';

		const federationService = container.resolve(FederationService);
		const eventService = container.resolve(EventService);
		const stagingAreaQueue = container.resolve(StagingAreaQueue);

		// resolved once init() in beforeAll has registered the lock collection
		let lockRepository: LockRepository;

		beforeAll(() => {
			lockRepository = container.resolve(LockRepository);
		});

		afterEach(() => {
			mock.restore();
			jest.useRealTimers();
		});

		// what the staging area queue does before processing a room
		const stagingCanLock = async () => {
			// eslint-disable-next-line prettier/prettier
			await using lock = await lockRepository.lock(remoteRoomId, stagingInstance);
			return lock.success;
		};

		const mockRemoteJoin = (onSendJoin?: () => void) => {
			const template = {
				type: 'm.room.member',
				content: { membership: 'join' },
				room_id: remoteRoomId,
				sender: bob,
				state_key: bob,
				auth_events: [],
				prev_events: [],
				depth: 1,
				origin_server_ts: Date.now(),
			};

			spyOn(federationService, 'makeJoin').mockResolvedValue({ event: template, room_version: '10' } as any);
			spyOn(federationService, 'sendJoin').mockImplementation(async (joinEvent) => {
				onSendJoin?.();
				return { state: [], auth_chain: [], event: joinEvent.event, servers_in_room: [] } as any;
			});
		};

		it('keeps the staging area out of the room until the send_join state is stored', async () => {
			let stagingCouldLockDuringInitialState: boolean | undefined;
			let stagingCouldLockWhenJoinIsStaged: Promise<boolean> | undefined;

			mockRemoteJoin();
			spyOn(stateService, 'processInitialState').mockImplementation(async () => {
				stagingCouldLockDuringInitialState = await stagingCanLock();
				return '' as any;
			});
			spyOn(eventService, 'processIncomingPDUs').mockImplementation(() => {
				stagingCouldLockWhenJoinIsStaged = stagingCanLock();
				return Promise.resolve();
			});

			await roomService.joinUser(remoteRoomId, bob);

			expect(stagingCouldLockDuringInitialState).toBe(false);
			expect(await stagingCouldLockWhenJoinIsStaged).toBe(true);
		});

		it('releases the room lock and re-enqueues the room for the staging area when storing the state fails', async () => {
			let stagingCouldLockWhenEnqueued: Promise<boolean> | undefined;

			mockRemoteJoin();
			spyOn(stateService, 'processInitialState').mockRejectedValue(new Error('bad state'));
			const enqueueSpy = spyOn(stagingAreaQueue, 'enqueue').mockImplementation(() => {
				stagingCouldLockWhenEnqueued = stagingCanLock();
			});

			await expect(roomService.joinUser(remoteRoomId, bob)).rejects.toThrow('bad state');

			expect(enqueueSpy).toHaveBeenCalledWith(remoteRoomId);
			expect(await stagingCouldLockWhenEnqueued).toBe(true);
		});

		it('keeps the room locked when storing the state outlasts the lock timeout', async () => {
			const lockCollection = container.resolve<Collection<Lock>>('LockCollection');
			const refreshSpy = spyOn(lockRepository, 'updateLockTimestamp');
			let stagingCouldLock: boolean | undefined;

			mockRemoteJoin();
			spyOn(stateService, 'processInitialState').mockImplementation(async () => {
				// as if storing the state had been running for longer than the lock timeout
				await lockCollection.updateOne(
					{ roomId: remoteRoomId },
					{ $set: { lockedAt: new Date(Date.now() - LOCK_TIMEOUT_MS - 60_000) } },
				);
				jest.advanceTimersByTime(LOCK_KEEP_ALIVE_INTERVAL_MS);
				await refreshSpy.mock.results.at(-1)?.value;

				stagingCouldLock = await stagingCanLock();
				return '' as any;
			});
			spyOn(eventService, 'processIncomingPDUs').mockResolvedValue();

			jest.useFakeTimers();
			await roomService.joinUser(remoteRoomId, bob);

			expect(refreshSpy).toHaveBeenCalled();
			expect(stagingCouldLock).toBe(false);
		});

		it('waits for the staging area to release the room before joining', async () => {
			expect(await lockRepository.getLock(remoteRoomId, stagingInstance)).toBe(true);
			let stagingReleasing = false;
			const stagingDone = Bun.sleep(300).then(() => {
				stagingReleasing = true;
				return lockRepository.releaseLock(remoteRoomId, stagingInstance);
			});

			let sentJoinWhileStagingHeldTheRoom: boolean | undefined;
			mockRemoteJoin(() => {
				sentJoinWhileStagingHeldTheRoom = !stagingReleasing;
			});
			spyOn(stateService, 'processInitialState').mockResolvedValue('' as any);
			spyOn(eventService, 'processIncomingPDUs').mockResolvedValue();

			await roomService.joinUser(remoteRoomId, bob);
			await stagingDone;

			expect(sentJoinWhileStagingHeldTheRoom).toBe(false);
		});
	});

	describe('room v12', () => {
		const alice = '@alice:example.com' as UserID;
		const bob = '@bob:example.com' as UserID;

		beforeAll(() => {
			federationSDK.setConfig({ signingKey: '', serverName: 'example.com', defaultRoomVersion: '12' } as AppConfig);
		});

		afterAll(() => {
			federationSDK.setConfig({ signingKey: '', serverName: 'example.com' } as AppConfig);
		});

		it('creates a room with a domainless id and leaves the creator out of power levels', async () => {
			const { roomCreateEvent, powerLevelEvent } = await createRoom(alice, 'public', { users: { [alice]: 10, [bob]: 50 } });

			expect(roomCreateEvent.roomId).toMatch(/^![A-Za-z0-9_-]{43}$/);
			expect(await stateService.getRoomVersion(roomCreateEvent.roomId)).toBe('12');

			expect(powerLevelEvent.getContent().users).toEqual({ [bob]: 50 });

			const roomState = await stateService.getLatestRoomState2(roomCreateEvent.roomId);
			expect(roomState.getUserPowerLevel(alice)).toBe(Infinity);
			expect(roomState.getUserPowerLevel(bob)).toBe(50);
		});

		it('joins, kicks and bans in a local v12 room', async () => {
			const { roomCreateEvent } = await createRoom(alice, 'public');
			const { roomId } = roomCreateEvent;

			await roomService.joinUser(roomId, bob);
			expect((await stateService.getLatestRoomState2(roomId)).isUserInRoom(bob)).toBeTrue();

			await federationSDK.kickUser(roomId, bob, alice);
			expect((await stateService.getLatestRoomState2(roomId)).getUserMembership(bob)).toBe('leave');

			await federationSDK.banUser(roomId, bob, alice);
			expect((await stateService.getLatestRoomState2(roomId)).getUserMembership(bob)).toBe('ban');
		});

		it('does not let a PL 100 member kick or ban the creator', async () => {
			const { roomCreateEvent } = await createRoom(alice, 'public', { users: { [bob]: 100 } });
			const { roomId } = roomCreateEvent;
			await roomService.joinUser(roomId, bob);

			await expect(federationSDK.kickUser(roomId, alice, bob)).rejects.toThrow('greater than or equal to your own');
			await expect(federationSDK.banUser(roomId, alice, bob)).rejects.toThrow('greater than or equal to your own');
		});

		it('updates a member power level without listing the creator', async () => {
			const { roomCreateEvent } = await createRoom(alice, 'public');
			const { roomId } = roomCreateEvent;
			await roomService.joinUser(roomId, bob);

			await federationSDK.updateUserPowerLevel(roomId, bob, 50, alice);

			const powerLevels = (await stateService.getLatestRoomState(roomId)).get('m.room.power_levels:')!.getContent();
			expect(powerLevels).toHaveProperty('users', { [bob]: 50 });
		});

		it("refuses to change a creator's power level", async () => {
			const { roomCreateEvent } = await createRoom(alice, 'public');
			const { roomId } = roomCreateEvent;

			await expect(federationSDK.updateUserPowerLevel(roomId, alice, 50, alice)).rejects.toThrow("creator's power level");
			await expect(roomService.setPowerLevelForUser(roomId, alice, alice, 50)).rejects.toThrow('room creator');
		});

		it('cannot join an unknown v12 room without an invite', async () => {
			const unknownRoomId = `!${'A'.repeat(43)}` as RoomID;

			await expect(roomService.joinUser(unknownRoomId, bob)).rejects.toThrow('has no invite');
		});

		it('accepts an invite to a local v12 room', async () => {
			const { roomCreateEvent } = await createRoom(alice, 'invite');
			const { roomId } = roomCreateEvent;

			await federationSDK.inviteUserToRoom(bob, roomId, alice);
			await federationSDK.acceptInvite(roomId, bob);

			expect((await stateService.getLatestRoomState2(roomId)).isUserInRoom(bob)).toBeTrue();
		});
	});

	describe('sendStateEvent', () => {
		const callMemberKey = (userId: UserID) => `_${userId}_DEVICE_m.call`;

		it('should set state of any type under any state key, empty content included', async () => {
			const username = '@alice:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'public');
			const { roomId } = roomCreateEvent;
			const stateMapKey = `org.matrix.msc3401.call.member:${callMemberKey(username)}` as StateMapKey;

			const joined = await federationSDK.sendStateEvent(
				roomId,
				'org.matrix.msc3401.call.member',
				callMemberKey(username),
				{ application: 'm.call', call_id: '', device_id: 'DEVICE' },
				username,
			);

			const stateAfterJoin = await stateService.getLatestRoomState(roomId);
			expect(stateAfterJoin.get(stateMapKey)?.eventId).toBe(joined.eventId);

			const left = await federationSDK.sendStateEvent(roomId, 'org.matrix.msc3401.call.member', callMemberKey(username), {}, username);

			const stateAfterLeave = await stateService.getLatestRoomState(roomId);
			expect(stateAfterLeave.get(stateMapKey)?.eventId).toBe(left.eventId);
			expect(stateAfterLeave.get(stateMapKey)?.getContent()).toEqual({});
		});

		it('should let a member without privileges publish their call membership', async () => {
			const username = '@alice:example.com' as UserID;
			const secondaryUsername = '@bob:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'public');
			const { roomId } = roomCreateEvent;

			await roomService.joinUser(roomId, secondaryUsername);

			const { eventId } = await federationSDK.sendStateEvent(
				roomId,
				'org.matrix.msc3401.call.member',
				callMemberKey(secondaryUsername),
				{ application: 'm.call', call_id: '', device_id: 'DEVICE' },
				secondaryUsername,
			);

			const state = await stateService.getLatestRoomState(roomId);
			expect(state.get(`org.matrix.msc3401.call.member:${callMemberKey(secondaryUsername)}` as StateMapKey)?.eventId).toBe(eventId);
		});

		it('should reject state the sender lacks the power level for', async () => {
			const username = '@alice:example.com' as UserID;
			const secondaryUsername = '@bob:example.com' as UserID;
			const { roomCreateEvent } = await createRoom(username, 'public');
			const { roomId } = roomCreateEvent;

			await roomService.joinUser(roomId, secondaryUsername);

			const error = await federationSDK
				.sendStateEvent(roomId, 'org.example.restricted', '', { value: 1 }, secondaryUsername)
				.catch((err: unknown) => err);

			expect(error).toBeInstanceOf(EventRejectedError);
			expect(error).toHaveProperty('code', 'auth_error');
			expect((error as EventRejectedError).reason).toContain('power level');

			const state = await stateService.getLatestRoomState(roomId);
			expect(state.has('org.example.restricted:' as StateMapKey)).toBe(false);
		});
	});

	describe('sticky events', () => {
		const remoteMember = '@carol:remote.example.com' as UserID;

		// a room on this server with a member from another server, built without federating anything
		const createRoomWithRemoteMember = async () => {
			const { roomCreateEvent } = await createRoom('@alice:example.com' as UserID, 'public');
			const { roomId } = roomCreateEvent;

			const join = await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					content: { membership: 'join' },
					room_id: roomId,
					state_key: remoteMember,
					sender: remoteMember,
					auth_events: [],
					prev_events: [],
					depth: 0,
					origin_server_ts: Date.now(),
				},
				roomCreateEvent.version,
			);
			await stateService.handlePdu(join);

			return roomId;
		};

		// an event as it arrives from the remote member's server
		const receiveFromRemoteMember = async (roomId: RoomID, fields: Record<string, unknown>, receivedAt: number) => {
			const event = await stateService.buildEvent({
				type: 'org.matrix.msc4143.rtc.member',
				content: { msc4354_sticky_key: 'member-1' },
				room_id: roomId,
				sender: remoteMember,
				auth_events: [],
				prev_events: [],
				depth: 0,
				origin_server_ts: receivedAt - 1_000,
				...fields,
			} as unknown as Pdu);

			await container.resolve(EventService).authorizeAndPersist(event, receivedAt);

			return event;
		};

		it('should keep a sticky event received over federation intact and list it until it expires', async () => {
			const roomId = await createRoomWithRemoteMember();
			const receivedAt = Date.now();

			const sticky = await receiveFromRemoteMember(roomId, { msc4354_sticky: { duration_ms: 3_600_000 } }, receivedAt);
			await receiveFromRemoteMember(roomId, { content: { body: 'not sticky' } }, receivedAt);

			const stored = await container.resolve(EventRepository).findById(sticky.eventId);
			expect(stored?.event).toHaveProperty('msc4354_sticky', { duration_ms: 3_600_000 });

			const expiresAt = receivedAt - 1_000 + 3_600_000;
			const active = await federationSDK.getActiveStickyEvents(roomId);
			expect(active).toEqual([
				{ event_id: sticky.eventId, event: expect.objectContaining({ msc4354_sticky: { duration_ms: 3_600_000 } }), expiresAt },
			]);

			expect(await federationSDK.getActiveStickyEvents(roomId, { now: expiresAt })).toEqual([]);
		});

		it('should tell the consumer when the stickiness of a received sticky event ends', async () => {
			const roomId = await createRoomWithRemoteMember();
			const receivedAt = Date.now();
			const notified: { event_id: string; sticky?: { expiresAt: number } }[] = [];
			const off = federationSDK.eventEmitterService.on('homeserver.matrix.event', ({ event_id, sticky }) => {
				notified.push({ event_id, sticky });
			});

			try {
				const sticky = await receiveFromRemoteMember(roomId, { msc4354_sticky: { duration_ms: 110_000 } }, receivedAt);
				const plain = await receiveFromRemoteMember(roomId, { content: { body: 'not sticky' } }, receivedAt);

				expect(notified).toEqual([
					{ event_id: sticky.eventId, sticky: { expiresAt: receivedAt - 1_000 + 110_000 } },
					{ event_id: plain.eventId, sticky: undefined },
				]);
			} finally {
				off?.();
			}
		});

		it('should list a sticky event sent by a local member until it expires', async () => {
			const { roomCreateEvent } = await createRoom('@alice:example.com' as UserID, 'public');
			const { roomId } = roomCreateEvent;

			const { eventId } = await federationSDK.sendStickyEvent(
				roomId,
				'org.matrix.msc4075.rtc.notification',
				{ slot_id: 'm.call#ROOM', msc4354_sticky_key: 'm.call#ROOM' },
				'@alice:example.com' as UserID,
				110_000,
			);

			const [active] = await federationSDK.getActiveStickyEvents(roomId);
			expect(active).toMatchObject({ event_id: eventId, event: { msc4354_sticky: { duration_ms: 110_000 } } });
			expect(active.expiresAt).toBe(active.event.origin_server_ts + 110_000);
		});

		it('should list only the sticky events of the requested type', async () => {
			const roomId = await createRoomWithRemoteMember();
			const receivedAt = Date.now();

			const member = await receiveFromRemoteMember(roomId, { msc4354_sticky: { duration_ms: 3_600_000 } }, receivedAt);
			await receiveFromRemoteMember(
				roomId,
				{
					type: 'org.matrix.msc4075.rtc.notification',
					content: { msc4354_sticky_key: 'm.call#ROOM' },
					msc4354_sticky: { duration_ms: 110_000 },
				},
				receivedAt,
			);

			const active = await federationSDK.getActiveStickyEvents(roomId, { type: 'org.matrix.msc4143.rtc.member' });

			expect(active.map(({ event_id }) => event_id)).toEqual([member.eventId]);
		});

		const receiveRedaction = async (roomId: RoomID, target: EventID, sender: UserID) => {
			const roomVersion = await stateService.getRoomVersion(roomId);
			const redaction = await stateService.buildEvent<'m.room.redaction'>(
				{
					type: 'm.room.redaction',
					...PersistentEventFactory.newRedactionEventFields(target, {}, roomVersion),
					room_id: roomId,
					sender,
					auth_events: [],
					prev_events: [],
					depth: 0,
					origin_server_ts: Date.now(),
				},
				roomVersion,
			);

			await container.resolve(EventService).authorizeAndPersist(redaction, Date.now());
		};

		it('should stop listing a sticky event once a redaction of it is received', async () => {
			const roomId = await createRoomWithRemoteMember();
			const sticky = await receiveFromRemoteMember(roomId, { msc4354_sticky: { duration_ms: 3_600_000 } }, Date.now());

			await receiveRedaction(roomId, sticky.eventId, remoteMember);

			expect(await federationSDK.getActiveStickyEvents(roomId)).toEqual([]);
		});

		it('should keep listing a sticky event when who redacts it is not allowed to', async () => {
			const { roomCreateEvent } = await createRoom('@alice:example.com' as UserID, 'public');
			const { roomId } = roomCreateEvent;
			const { eventId } = await federationSDK.sendStickyEvent(
				roomId,
				'org.matrix.msc4143.rtc.member',
				{ msc4354_sticky_key: 'member-1' },
				'@alice:example.com' as UserID,
				110_000,
			);
			const join = await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					content: { membership: 'join' },
					room_id: roomId,
					state_key: remoteMember,
					sender: remoteMember,
					auth_events: [],
					prev_events: [],
					depth: 0,
					origin_server_ts: Date.now(),
				},
				roomCreateEvent.version,
			);
			await stateService.handlePdu(join);

			await receiveRedaction(roomId, eventId, remoteMember);

			expect((await federationSDK.getActiveStickyEvents(roomId)).map(({ event_id }) => event_id)).toEqual([eventId]);
		});

		it('should stop listing a sticky event once a local member redacts it', async () => {
			const { roomCreateEvent } = await createRoom('@alice:example.com' as UserID, 'public');
			const { roomId } = roomCreateEvent;
			const { eventId } = await federationSDK.sendStickyEvent(
				roomId,
				'org.matrix.msc4143.rtc.member',
				{ msc4354_sticky_key: 'member-1' },
				'@alice:example.com' as UserID,
				110_000,
			);

			await federationSDK.redactMessage(roomId, eventId);

			expect(await federationSDK.getActiveStickyEvents(roomId)).toEqual([]);
		});

		it('should keep when the stickiness of an event ends when the event is seen again', async () => {
			const roomId = await createRoomWithRemoteMember();
			const receivedAt = Date.now();
			const sticky = await receiveFromRemoteMember(roomId, { msc4354_sticky: { duration_ms: 110_000 } }, receivedAt);

			const expiresAt = await container.resolve(StickyEventService).markSticky(sticky, receivedAt - 60_000);

			expect(expiresAt).toBe(receivedAt - 1_000 + 110_000);
		});

		it('should not take for sticky an event that is stored as rejected', async () => {
			const roomId = await createRoomWithRemoteMember();
			const receivedAt = Date.now();

			let rejected: PersistentEventBase | undefined;
			const buildEvent = spyOn(stateService, 'buildEvent');
			try {
				await receiveFromRemoteMember(
					roomId,
					{ sender: '@mallory:evil.example.com', msc4354_sticky: { duration_ms: 3_600_000 } },
					receivedAt,
				).catch(() => undefined);
				rejected = (await buildEvent.mock.results[0]?.value) as PersistentEventBase;
			} finally {
				buildEvent.mockRestore();
			}

			const stored = await container.resolve(EventRepository).findById(rejected.eventId);
			expect(stored?.rejectCode).toBeDefined();

			// the same event as a later attempt would load it, with nothing telling it was rejected
			const again = PersistentEventFactory.createFromRawEvent(rejected.event, rejected.version);
			expect(await container.resolve(StickyEventService).markSticky(again, receivedAt)).toBeUndefined();
			expect(await federationSDK.getActiveStickyEvents(roomId)).toEqual([]);
		});

		it('should push again the sticky events of local members to the servers in their rooms', async () => {
			const roomId = await createRoomWithRemoteMember();
			await receiveFromRemoteMember(roomId, { msc4354_sticky: { duration_ms: 3_600_000 } }, Date.now());

			// sending the event already relays it once, in the background
			const sendPDUToMultiple = spyOn(container.resolve(FederationSenderService), 'sendPDUToMultiple').mockImplementation(() => undefined);
			const sendPDU = spyOn(container.resolve(FederationSenderService), 'sendPDU').mockImplementation(() => undefined);
			try {
				const { eventId } = await federationSDK.sendStickyEvent(
					roomId,
					'org.matrix.msc4143.rtc.member',
					{ msc4354_sticky_key: 'member-2' },
					'@alice:example.com' as UserID,
					110_000,
				);

				await container.resolve(StickyEventService).pushOwnStickyEventsToServers('remote.example.com');

				const pushed = sendPDU.mock.calls.filter(([, pdu]) => pdu.room_id === roomId);
				expect(pushed).toEqual([['remote.example.com', expect.objectContaining({ msc4354_sticky: { duration_ms: 110_000 } })]]);
				expect((await container.resolve(EventRepository).findById(eventId))?.event).toEqual(pushed[0][1]);
			} finally {
				sendPDU.mockRestore();
				sendPDUToMultiple.mockRestore();
			}
		});

		it('should stop listing a sticky event once it is redacted', async () => {
			const roomId = await createRoomWithRemoteMember();

			const sticky = await receiveFromRemoteMember(roomId, { msc4354_sticky: { duration_ms: 3_600_000 } }, Date.now());
			await container.resolve(EventRepository).redactEvent(sticky.eventId, sticky.redactedEvent as unknown as Pdu);

			expect(await federationSDK.getActiveStickyEvents(roomId)).toEqual([]);
		});
	});

	describe('catching up newly joined servers on sticky events', () => {
		const alice = '@alice:example.com' as UserID;

		let catchUps: (() => void)[];
		let queued: [string, Pdu][];
		// other rooms may get pushes of their own meanwhile, as the one this server makes when it starts
		const queuedFor = (roomId: RoomID) => queued.filter(([, pdu]) => pdu.room_id === roomId);
		let spies: { mockRestore(): void }[];

		beforeEach(() => {
			catchUps = [];
			queued = [];

			const realSetTimeout = globalThis.setTimeout;
			spies = [
				spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delayMs?: number, ...args: unknown[]) => {
					if (delayMs !== NEW_SERVER_CATCH_UP_DELAY_MS) {
						return realSetTimeout(callback, delayMs, ...args);
					}
					catchUps.push(callback);
					return { unref: () => undefined };
				}) as unknown as typeof setTimeout),
				spyOn(container.resolve(FederationSenderService), 'sendPDU').mockImplementation((destination: string, pdu: Pdu) => {
					queued.push([destination, pdu]);
				}),
				spyOn(container.resolve(FederationSenderService), 'sendPDUToMultiple').mockImplementation(() => undefined),
			];
		});

		afterEach(() => {
			for (const spy of spies) {
				spy.mockRestore();
			}
		});

		// the catch-up runs in the background of the call that triggers it
		const settle = async (until: () => boolean) => {
			const deadline = Date.now() + 2_000;
			while (!until() && Date.now() < deadline) {
				// eslint-disable-next-line no-await-in-loop
				await new Promise((resolve) => setImmediate(resolve));
			}
		};

		// a public room on this server where alice is in a call
		const createRoomWithOwnStickyEvent = async () => {
			const { roomCreateEvent } = await createRoom(alice, 'public');
			const { roomId } = roomCreateEvent;

			const { eventId } = await federationSDK.sendStickyEvent(
				roomId,
				'org.matrix.msc4143.rtc.member',
				{ slot_id: 'm.call#ROOM', msc4354_sticky_key: 'member-1' },
				alice,
				3_600_000,
			);

			return { roomId, stickyEventId: eventId };
		};

		const buildJoin = (roomId: RoomID, userId: UserID) =>
			stateService.buildEvent<'m.room.member'>({
				type: 'm.room.member',
				content: { membership: 'join' },
				room_id: roomId,
				state_key: userId,
				sender: userId,
				auth_events: [],
				prev_events: [],
				depth: 0,
				origin_server_ts: Date.now(),
			});

		it('should push its own sticky events to a server whose first member joins through send_join', async () => {
			const { roomId, stickyEventId } = await createRoomWithOwnStickyEvent();
			const join = await buildJoin(roomId, '@dave:other.example.com' as UserID);

			await federationSDK.sendJoin(roomId, join.eventId, join.event);
			await settle(() => catchUps.length > 0);

			expect(catchUps).toHaveLength(1);
			expect(queuedFor(roomId)).toEqual([]);

			catchUps[0]();
			await settle(() => queuedFor(roomId).length > 0);

			expect(queuedFor(roomId).map(([destination, pdu]) => [destination, pdu.type])).toEqual([
				['other.example.com', 'org.matrix.msc4143.rtc.member'],
			]);
			const [, pushed] = queuedFor(roomId)[0];
			expect(pushed).toHaveProperty('msc4354_sticky', { duration_ms: 3_600_000 });
			expect(PersistentEventFactory.createFromRawEvent(pushed, '10').eventId).toBe(stickyEventId);
		});

		it('should push its own sticky events to a server whose first member joins through an event it learns about', async () => {
			const { roomId } = await createRoomWithOwnStickyEvent();

			await container.resolve(EventService).authorizeAndPersist(await buildJoin(roomId, '@carol:remote.example.com' as UserID), Date.now());
			await settle(() => catchUps.length > 0);

			expect(catchUps).toHaveLength(1);
			catchUps[0]();
			await settle(() => queuedFor(roomId).length > 0);

			expect(queuedFor(roomId).map(([destination]) => destination)).toEqual(['remote.example.com']);
		});

		it('should not push again when another member of an already joined server joins', async () => {
			const { roomId } = await createRoomWithOwnStickyEvent();
			const eventService = container.resolve(EventService);

			await eventService.authorizeAndPersist(await buildJoin(roomId, '@carol:remote.example.com' as UserID), Date.now());
			await settle(() => catchUps.length > 0);
			const erinJoin = await buildJoin(roomId, '@erin:remote.example.com' as UserID);
			const catchUp = spyOn(container.resolve(StickyEventService), 'catchUpIfNewServer');
			try {
				await eventService.authorizeAndPersist(erinJoin, Date.now());
				await settle(() => catchUp.mock.calls.length > 0);
				expect(await catchUp.mock.results[0].value).toBeUndefined();
			} finally {
				catchUp.mockRestore();
			}

			expect(catchUps).toHaveLength(1);
		});
	});
});
