import { beforeAll, describe, expect, it } from 'bun:test';

import type * as room from '@rocket.chat/federation-room';
import type {
	PduJoinRuleEventContent,
	PduPowerLevelsEventContent,
	PersistentEventBase,
	RoomVersion,
	StateMapKey,
} from '@rocket.chat/federation-room';
import { container } from 'tsyringe';

import { FederationValidationService, federationSDK, init } from '..';
import { AppConfig, ConfigService } from './config.service';
import { RoomService } from './room.service';
import { StateService } from './state.service';

describe('RoomService', async () => {
	if (!process.env.RUN_MONGO_TESTS) {
		console.warn('Skipping tests that require a database');
		return;
	}

	beforeAll(() => {
		const databaseConfig = {
			uri: process.env.MONGO_URI || 'mongodb://localhost:27017?directConnection=true',
			name: 'matrix_test',
			poolSize: 100,
		};

		init({
			dbConfig: databaseConfig,
		});
	});

	const configService = new ConfigService();
	federationSDK.setConfig({
		signingKey: '',
		serverName: 'example.com',
	} as AppConfig);

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
		username: room.UserID,
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
			const username = '@alice:example.com' as room.UserID;
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
			const username = '@alice:example.com' as room.UserID;
			const { powerLevelEvent } = await createRoom(username, 'public', {
				users: { '@alice:example.com': 10 },
			});

			expect(powerLevelEvent.getContent().users[username]).toBe(100);
		});

		it('should accept custom event powers', async () => {
			const username = '@alice:example.com' as room.UserID;
			const { powerLevelEvent } = await createRoom(username, 'public', {
				events: { 'rc.room.name': 10 },
			});
			expect(powerLevelEvent.getContent().events['rc.room.name']).toBe(10);
		});

		it.skip('should create direct message room correctly', async () => {
			const username = '@alice:example.com' as room.UserID;
			const targetUsername = '@bob:example.com' as room.UserID;

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
			const username = '@alice:example.com' as room.UserID;
			const secondaryUsername = '@bob:example.com' as room.UserID;
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
			const username = '@alice:example.com' as room.UserID;
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
			const username = '@alice:example.com' as room.UserID;
			const secondaryUsername = '@bob:example.com' as room.UserID;
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
			const username = '@alice:example.com' as room.UserID;
			const secondaryUsername = '@bob:example.com' as room.UserID;
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
			const username = '@alice:example.com' as room.UserID;
			const secondaryUsername = '@bob:example.com' as room.UserID;
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
	});

	describe('acceptInvite', () => {
		it('should accept invite and join user to room correctly', async () => {
			const username = '@alice:example.com' as room.UserID;
			const invitedUsername = '@bob:example.com' as room.UserID;
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
			const username = '@alice:example.com' as room.UserID;
			const invitedUsername = '@bob:example.com' as room.UserID;
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
});
