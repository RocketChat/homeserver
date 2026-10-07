import { afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import type {
	Pdu,
	PduJoinRuleEventContent,
	PduPowerLevelsEventContent,
	PersistentEventBase,
	RoomID,
	RoomVersion,
	StateMapKey,
	UserID,
} from '@rocket.chat/federation-room';
import { PersistentEventFactory } from '@rocket.chat/federation-room';
import { container } from 'tsyringe';

import { EventRejectedError, FederationValidationService, federationSDK, init } from '..';
import { AppConfig, ConfigService } from './config.service';
import { EventService } from './event.service';
import { FederationSenderService } from './federation-sender.service';
import { RoomService } from './room.service';
import { StateService } from './state.service';
import { NEW_SERVER_CATCH_UP_DELAY_MS, StickyEventService } from './sticky-event.service';
import { EventRepository } from '../repositories/event.repository';

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
			expect(queued).toEqual([]);

			catchUps[0]();
			await settle(() => queued.length > 0);

			expect(queued.map(([destination, pdu]) => [destination, pdu.type])).toEqual([['other.example.com', 'org.matrix.msc4143.rtc.member']]);
			const [, pushed] = queued[0];
			expect(pushed).toHaveProperty('msc4354_sticky', { duration_ms: 3_600_000 });
			expect(PersistentEventFactory.createFromRawEvent(pushed, '10').eventId).toBe(stickyEventId);
		});

		it('should push its own sticky events to a server whose first member joins through an event it learns about', async () => {
			const { roomId } = await createRoomWithOwnStickyEvent();

			await container.resolve(EventService).authorizeAndPersist(await buildJoin(roomId, '@carol:remote.example.com' as UserID), Date.now());
			await settle(() => catchUps.length > 0);

			expect(catchUps).toHaveLength(1);
			catchUps[0]();
			await settle(() => queued.length > 0);

			expect(queued.map(([destination]) => destination)).toEqual(['remote.example.com']);
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
