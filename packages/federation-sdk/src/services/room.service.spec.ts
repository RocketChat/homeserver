import { afterAll, afterEach, beforeAll, describe, expect, it, jest, mock, spyOn } from 'bun:test';

import {
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

import { FederationValidationService, federationSDK, init } from '..';
import { AppConfig, ConfigService } from './config.service';
import { EventService } from './event.service';
import { FederationService } from './federation.service';
import { RoomService } from './room.service';
import { StateService } from './state.service';
import { StagingAreaQueue } from '../queues/staging-area.queue';
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

			const { event, room_version } = await roomService.makeLeave(roomId, carol);
			const leaveEvent = PersistentEventFactory.createFromRawEvent<'m.room.member'>(event, room_version);

			await roomService.sendLeave(roomId, leaveEvent.eventId, leaveEvent.event);

			const state = await stateService.getLatestRoomState(roomId);
			expect(state.get(`m.room.member:${carol}`)?.getContent().membership).toBe('leave');
		});

		it('refuses a leave when no local user is joined to the room', async () => {
			const roomId = await createRoomWithRemoteInvite();
			await roomService.leaveRoom(roomId, alice);

			const { event, room_version } = await roomService.makeLeave(roomId, carol);
			const leaveEvent = PersistentEventFactory.createFromRawEvent<'m.room.member'>(event, room_version);

			await expect(roomService.sendLeave(roomId, leaveEvent.eventId, leaveEvent.event)).rejects.toThrow('is not resident in room');
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
});
