import { it, describe, expect, afterEach } from 'bun:test';
import { PersistentEventBase } from '../manager/event-wrapper';
import { PersistentEventFactory } from '../manager/factory';
import { type PduJoinRuleEventContent, type PduType } from '../types/v1';
import { checkEventAuthWithoutState, checkEventAuthWithState } from './rules';
import type { EventStore } from '../state_resolution/definitions/definitions';
import type { PduPowerLevelsEventV10Content, PduV10 } from '../types/v10';
import { type StateMapKey } from '../types/_common';

function getStateMapKey(event: PersistentEventBase): StateMapKey {
	return `${event.type}:${event.stateKey ?? ''}`;
}

class MockStore implements EventStore {
	events: Map<string, PersistentEventBase> = new Map();

	async getEvents(eventIds: string[]): Promise<PersistentEventBase[]> {
		return eventIds.map((id) => this.events.get(id) as PersistentEventBase);
	}

	async getEventsByHashes(hashes: string[]): Promise<PersistentEventBase[]> {
		const byHash = new Map();
		for (const event of this.events.values()) {
			byHash.set(event.sha256hash, event);
		}
		return hashes.map((h) => byHash.get(h) as PersistentEventBase);
	}
}

class FakeStateEventCreator {
	protected _event!: PduV10;
	constructor() {
		this._event = {
			state_key: '', // always a state
			content: {},
			type: '',
			auth_events: [],
			prev_events: [],
			room_id: '',
			sender: '',
		} as unknown as PduV10;
	}

	withStateKey(stateKey: string) {
		this._event.state_key = stateKey;
		return this;
	}

	withType(type: PduType | 'test') {
		this._event.type = type as PduType;
		return this;
	}

	withSender(sender: string) {
		this._event.sender = sender;
		return this;
	}

	withRoomId(roomId: string) {
		this._event.room_id = roomId;
		return this;
	}

	authedBy(authEvent: PersistentEventBase) {
		this._event.auth_events.push(authEvent.eventId);
		return this;
	}

	withLastEvent(lastEvent: PersistentEventBase) {
		this._event.prev_events.push(lastEvent.eventId);
		return this;
	}

	withContent(content: any) {
		this._event.content = content;
		return this;
	}

	asRoomCreate() {
		return this.withType('m.room.create');
	}

	asRoomMember() {
		return this.withType('m.room.member');
	}

	asRoomJoinRules() {
		return this.withType('m.room.join_rules');
	}

	asPowerLevel() {
		return this.withType('m.room.power_levels');
	}

	asTest() {
		return this.withType('test');
	}

	build() {
		return PersistentEventFactory.createFromRawEvent(this._event, '10');
	}
}

class FakeMessageEventCreator extends FakeStateEventCreator {
	constructor() {
		super();
		this.withType('m.room.message');
	}
}

const store = new MockStore();

const roomId = '!room:example.com';
const creator = '@creator:example.com';

function getInitialEvents(
	{ joinRule = 'public' }: { joinRule?: 'public' | 'invite' } = {},
	powerLevelContent: any = {
		state_default: 30,
		users: {
			[creator]: 100,
		},
	},
) {
	const create = new FakeStateEventCreator()
		.asRoomCreate()
		.withRoomId(roomId)
		.withSender(creator)
		.withContent({ creator })
		.build();

	store.events.set(create.eventId, create);

	const join = new FakeStateEventCreator()
		.asRoomMember()
		.withRoomId(roomId)
		.withStateKey(creator)
		.withSender(creator)
		.withContent({ membership: 'join' })
		.build();

	store.events.set(join.eventId, join);

	const powerLevel = new FakeStateEventCreator()
		.asPowerLevel()
		.withRoomId(roomId)
		.withSender(creator)
		.withContent(powerLevelContent)
		.build();

	store.events.set(powerLevel.eventId, powerLevel);

	const joinRules = new FakeStateEventCreator()
		.asRoomJoinRules()
		.withRoomId(roomId)
		.withSender(creator)
		.withContent({ join_rule: joinRule })
		.build();

	store.events.set(joinRules.eventId, joinRules);

	return { create, join, powerLevel, joinRules };
}

function getStateMap(events: PersistentEventBase[]) {
	return new Map<StateMapKey, PersistentEventBase>(
		events.map((event) => [getStateMapKey(event), event]),
	);
}

// numbering tests for easier debugging, see tasks.json's inputs

describe('authorization rules', () => {
	afterEach(() => store.events.clear());

	it('01 should reject any event with rejected auth events', async () => {
		const { create, join } = getInitialEvents();

		const randomEvent = new FakeStateEventCreator()
			.asTest()
			.withSender(creator)
			.withContent({})
			.withRoomId(roomId)
			.withStateKey(creator)
			.build();

		expect(() =>
			checkEventAuthWithoutState(randomEvent, [create, join]),
		).not.toThrow();

		const joinRules = new FakeStateEventCreator()
			.asRoomJoinRules()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({
				join_rule: 'invite',
			})
			.build();

		expect(() =>
			checkEventAuthWithoutState(randomEvent, [create, join, joinRules]),
		).toThrow();
	});

	it('02 should reject create event if has any prev_events', async () => {
		const { create } = getInitialEvents();

		expect(() => checkEventAuthWithoutState(create, [])).not.toThrow();

		const create2 = new FakeStateEventCreator()
			.asRoomCreate()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ creator })
			.withLastEvent(create)
			.build();

		expect(() => checkEventAuthWithoutState(create2, [])).toThrow();
	});

	it('03 should reject events with duplicate auth_events', async () => {
		// creator creates room
		const { create } = getInitialEvents();

		// creator joins room
		const join = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'join' })
			.withStateKey(creator)
			.build();

		// random event1
		const randomEvent = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({})
			.withStateKey(creator)
			.build();

		// should be allowed
		expect(() =>
			checkEventAuthWithoutState(randomEvent, [create, join]),
		).not.toThrow();

		// random event2
		const randomEvent2 = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({})
			.withStateKey(creator)
			.build();

		// should be rejected
		expect(() =>
			checkEventAuthWithoutState(randomEvent2, [create, join, join]),
		).toThrow();
	});

	it('04 should reject events with excess auth events', async () => {
		const { create, join, powerLevel, joinRules } = getInitialEvents();

		const goodEvent = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({})
			.withStateKey(creator)
			.authedBy(create)
			.authedBy(join)
			.authedBy(powerLevel)
			.build();

		const badEvent = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({})
			.withStateKey(creator)
			.authedBy(create)
			.authedBy(join)
			.authedBy(powerLevel)
			.authedBy(joinRules) // why
			.build();

		expect(() =>
			checkEventAuthWithoutState(goodEvent, [create, join, powerLevel]),
		).not.toThrow();

		expect(() =>
			checkEventAuthWithoutState(badEvent, [
				create,
				join,
				powerLevel,
				joinRules,
			]),
		).toThrow();
	});

	it('05 should reject state events from random users before first power level event', async () => {
		const { create, join } = getInitialEvents();

		const alice = '@alice:example.com';

		const inviteAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'invite' })
			.withStateKey(alice)
			.build();

		store.events.set(inviteAlice.eventId, inviteAlice);

		const currentState = getStateMap([create, join, inviteAlice]);

		const randomStateEvent = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({})
			.build();

		// creator should be able to send any event
		expect(() =>
			checkEventAuthWithState(randomStateEvent, currentState, store),
		).not.toThrow();

		const randomEventSentByAlice = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({})
			.build();

		expect(() =>
			checkEventAuthWithState(randomEventSentByAlice, currentState, store),
		).toThrow();
	});

	it('06 users below state_default should not be able to send any state', async () => {
		const alice = '@alice:example.com';
		const bob = '@bob:example.com';

		const { create, join, powerLevel } = getInitialEvents(
			{},
			{
				events: {},
				state_default: 30,
				users: {
					[alice]: 29,
					[bob]: 30,
				},
			},
		);

		const joinBob = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(bob)
			.withContent({ membership: 'join' })
			.withStateKey(bob)
			.build();

		const joinAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		const state = getStateMap([create, join, powerLevel, joinBob, joinAlice]);

		const randomStateEvent = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(alice) // should not be able to send any state
			.withContent({})
			.build();

		expect(() =>
			checkEventAuthWithState(randomStateEvent, state, store),
		).toThrow();

		const randomStateEvent2 = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(bob) // should be able to send state
			.withContent({})
			.build();

		expect(() =>
			checkEventAuthWithState(randomStateEvent2, state, store),
		).not.toThrow();
	});

	// TODO: alias rooms
	it('07 joining rooms', async () => {
		const { create, join, /*powerLevel,*/ joinRules } = getInitialEvents({
			joinRule: 'public',
		});

		const state = getStateMap([create, join, joinRules]);

		const alice = '@alice:example.com';

		const joinAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		// alice should be able to join the room
		expect(() =>
			checkEventAuthWithState(joinAlice, state, store),
		).not.toThrow();
		// expect(joinAlice.rejected).toBe(false);

		// user can not be forced to join the room
		const forceJoinAliceByCreator = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		expect(() =>
			checkEventAuthWithState(forceJoinAliceByCreator, state, store),
		).toThrow();
		// expect(forceJoinAliceByCreator.rejected).toBe(true);

		// banned should be rejected
		const banAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'ban' })
			.withStateKey(alice)
			.build();

		const stateWithBan = getStateMap([create, join, joinRules, banAlice]);

		expect(() =>
			checkEventAuthWithState(joinAlice, stateWithBan, store),
		).toThrow();
		// expect(joinAlice.rejected).toBe(true);

		// a user who left should be able to rejoin
		const leaveAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'leave' })
			.withStateKey(alice)
			.build();

		const stateWithLeave = getStateMap([create, join, joinRules, leaveAlice]);

		expect(() =>
			checkEventAuthWithState(joinAlice, stateWithLeave, store),
		).not.toThrow();

		// a user can send a join if in the room
		const stateWithAlice = getStateMap([create, join, joinRules, joinAlice]);

		expect(() =>
			checkEventAuthWithState(joinAlice, stateWithAlice, store),
		).not.toThrow();

		// a user can accept an invite
		const inviteAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'invite' })
			.withStateKey(alice)
			.build();

		const stateWithInvite = getStateMap([create, join, joinRules, inviteAlice]);

		expect(() =>
			checkEventAuthWithState(joinAlice, stateWithInvite, store),
		).not.toThrow();

		// should not be able to join if private
		const privateJoinRules = new FakeStateEventCreator()
			.asRoomJoinRules()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ join_rule: 'private' })
			.build();

		const stateWithPrivateJoinRules = getStateMap([
			create,
			join,
			privateJoinRules,
		]);

		expect(() =>
			checkEventAuthWithState(joinAlice, stateWithPrivateJoinRules, store),
		).toThrow();
	});

	it('08 test joining an invite only room', async () => {
		const { create, join, /*powerLevel,*/ joinRules } = getInitialEvents({
			joinRule: 'invite',
		});

		const state = getStateMap([create, join, joinRules]);

		const alice = '@alice:example.com';

		// NO join without an invite
		const joinAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		expect(() => checkEventAuthWithState(joinAlice, state, store)).toThrow();

		// can not  be force joined
		const forceJoinAliceByCreator = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		expect(() =>
			checkEventAuthWithState(forceJoinAliceByCreator, state, store),
		).toThrow();

		// banned should be rejected
		const banAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'ban' })
			.withStateKey(alice)
			.build();

		const stateWithBan = getStateMap([create, join, joinRules, banAlice]);

		expect(() =>
			checkEventAuthWithState(joinAlice, stateWithBan, store),
		).toThrow();

		// who left should not be able to rejoin
		const leaveAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'leave' })
			.withStateKey(alice)
			.build();

		const stateWithLeave = getStateMap([create, join, joinRules, leaveAlice]);

		expect(() =>
			checkEventAuthWithState(joinAlice, stateWithLeave, store),
		).toThrow();

		// in the room === can "join"
		const stateWithAlice = getStateMap([create, join, joinRules, joinAlice]);

		expect(() =>
			checkEventAuthWithState(joinAlice, stateWithAlice, store),
		).not.toThrow();

		// invite should be allowed to be accepted
		const inviteAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'invite' })
			.withStateKey(alice)
			.build();

		const stateWithInvite = getStateMap([create, join, joinRules, inviteAlice]);

		expect(() =>
			checkEventAuthWithState(joinAlice, stateWithInvite, store),
		).not.toThrow();
	});

	it('09 should not allow state event sending if power level is too low', async () => {
		const alice = '@alice:example.com';

		const joinAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		const setAlicePower = (power: number) => {
			const { create, join, powerLevel, joinRules } = getInitialEvents(
				{ joinRule: 'public' },
				{
					events: {},
					users: {
						[alice]: power,
					},
					state_default: 30,
					events_default: 50,
				},
			);

			return getStateMap([create, join, powerLevel, joinRules, joinAlice]);
		};

		// alice shoould not be able to send a state event if power is lower than 30
		const state29 = setAlicePower(29);

		const randomStateEvent = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({})
			.build();

		expect(() =>
			checkEventAuthWithState(randomStateEvent, state29, store),
		).toThrow();

		// alice should be able to send a state event if power is 30
		const state30 = setAlicePower(30);

		expect(() =>
			checkEventAuthWithState(randomStateEvent, state30, store),
		).not.toThrow();

		// should not be able to send a message if power < 50
		const state49 = setAlicePower(49);

		const messageEvent = new FakeMessageEventCreator()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({})
			.build();

		expect(() =>
			checkEventAuthWithState(messageEvent, state49, store),
		).toThrow();

		const state51 = setAlicePower(51);

		expect(() =>
			checkEventAuthWithState(messageEvent, state51, store),
		).not.toThrow();

		// setting custom power required for test events
		const randomStateEvent2 = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({})
			.build();

		const stateX = (() => {
			const { create, join, powerLevel, joinRules } = getInitialEvents(
				{
					joinRule: 'public',
				},
				{
					events: {
						[randomStateEvent2.type]: 100,
					},
					users: {
						[alice]: 51, // alice should not be able to send randomStateEvent2
					},

					state_default: 30,
				},
			);

			return getStateMap([create, join, powerLevel, joinRules, joinAlice]);
		})();

		expect(() =>
			checkEventAuthWithState(randomStateEvent2, stateX, store),
		).toThrow();

		// setting custom power required for test events
		const stateY = (() => {
			const { create, join, powerLevel, joinRules } = getInitialEvents(
				{
					joinRule: 'public',
				},
				{
					events: {
						[randomStateEvent2.type]: 50,
					},
					users: {
						[alice]: 51, // alice should not be able to send randomStateEvent2
					},
				},
			);

			return getStateMap([create, join, powerLevel, joinRules, joinAlice]);
		})();

		expect(() =>
			checkEventAuthWithState(randomStateEvent2, stateY, store),
		).not.toThrow();
	});

	it('10 should resolve power events correctly', async () => {
		const {
			create,
			join,
			powerLevel: existingPowerLevel,
			joinRules,
		} = getInitialEvents({
			joinRule: 'public',
		});

		const initialState = getStateMap([create, join, joinRules]);

		// should allow the first powerlevel
		expect(() =>
			checkEventAuthWithState(existingPowerLevel, initialState, store),
		).not.toThrow();

		const alice = '@alice:example.com';

		const joinAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		const secondState = getStateMap([
			create,
			join,
			joinRules,
			existingPowerLevel,
			joinAlice,
		]);

		const newPowerLevel = new FakeStateEventCreator()
			.asPowerLevel()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({
				events: {},
				users: {
					[alice]: 50, // new power level
				},
				users_default: 60,
			})
			.build();

		const setPowerLevel = (
			powerLevel: PersistentEventBase,
			state: typeof secondState,
		) => {
			state.set(powerLevel.getUniqueStateIdentifier(), powerLevel);
		};

		const createPowerLevel = (content: PduPowerLevelsEventV10Content) => {
			return new FakeStateEventCreator()
				.asPowerLevel()
				.withRoomId(roomId)
				.withSender(alice)
				.withContent(content)
				.build();
		};

		// should not be able to increase default user power level if doesn't have enough power to begin with
		setPowerLevel(
			createPowerLevel({
				events: {},
				users: {
					[alice]: 50, // senders current power level
				},
				users_default: 50,
				state_default: 50,
				ban: 50,
				kick: 50,
				redact: 50,
				invite: 50,
			}),
			secondState,
		);

		// sender is trying to increase their power level without having the required power to do it
		expect(() =>
			checkEventAuthWithState(newPowerLevel, secondState, store),
		).toThrow();

		const newPowerLevel2 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			users_default: 30,
		});

		// reducing
		expect(() =>
			checkEventAuthWithState(newPowerLevel2, secondState, store),
		).not.toThrow();

		// events_default

		// should not be able to increase events_default if doesn't have enough power
		const newPowerLevel3 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			events_default: 60,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel3, secondState, store),
		).toThrow();

		const newPowerLevel4 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			events_default: 40, // should be able to reduce events_default
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel4, secondState, store),
		).not.toThrow();

		// state_default

		const newPowerLevel5 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			state_default: 60,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel5, secondState, store),
		).toThrow();

		const newPowerLevel6 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			state_default: 40,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel6, secondState, store),
		).not.toThrow();

		const newPowerLevel7 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			ban: 60,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel7, secondState, store),
		).toThrow();

		const newPowerLevel8 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			ban: 40,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel8, secondState, store),
		).not.toThrow();

		// kick
		const newPowerLevel9 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			kick: 60,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel9, secondState, store),
		).toThrow();

		const newPowerLevel10 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			kick: 40,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel10, secondState, store),
		).not.toThrow();

		// invite
		const newPowerLevel11 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			invite: 60,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel11, secondState, store),
		).toThrow();

		const newPowerLevel12 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			invite: 40,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel12, secondState, store),
		).not.toThrow();

		// redact
		const newPowerLevel13 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			redact: 60,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel13, secondState, store),
		).toThrow();

		const newPowerLevel14 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			redact: 40,
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel14, secondState, store),
		).not.toThrow();

		// for each event type
		// if value is added check against users power level if is higher, reject
		setPowerLevel(
			createPowerLevel({
				events: {},
				users: {
					[alice]: 50,
				},
			}),
			secondState,
		);

		const newPowerLevel15 = createPowerLevel({
			events: {
				test: 60,
			},
			users: {
				[alice]: 50,
			},
		});

		// 'test' is added with higher power level than alice's current power level, reject
		expect(() =>
			checkEventAuthWithState(newPowerLevel15, secondState, store),
		).toThrow();

		// 'test' is added with lower power level than alice's current power level, allow
		const newPowerLevel16 = createPowerLevel({
			events: {
				test: 50,
			},
			users: {
				[alice]: 50,
			},
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel16, secondState, store),
		).not.toThrow();

		// only allow removal of an event's required power if it is lower than or equal to user's current power
		setPowerLevel(
			createPowerLevel({
				events: {
					test: 50,
				},
				users: {
					[alice]: 50,
				},
			}),
			secondState,
		);

		const newPowerLevel17 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel17, secondState, store),
		).not.toThrow();

		setPowerLevel(
			createPowerLevel({
				events: {
					test: 60,
				},
				users: {
					[alice]: 50,
				},
			}),
			secondState,
		);

		const newPowerLevel18 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
		});

		// 'test' is removed with higher power level than alice's current power level, reject
		expect(() =>
			checkEventAuthWithState(newPowerLevel18, secondState, store),
		).toThrow();

		const bob = '@bob:example.com';

		// can not increase bob's power level if alice doesn't have enough power
		setPowerLevel(
			createPowerLevel({
				events: {},
				users: {
					[alice]: 50,
					[bob]: 50,
				},
			}),
			secondState,
		);

		const newPowerLevel19 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
				[bob]: 60,
			},
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel19, secondState, store),
		).toThrow();

		// can reduce bob's power level if alice has enough power
		const newPowerLevel20 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
				[bob]: 40,
			},
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel20, secondState, store),
		).not.toThrow();

		// can not remove bob's power level if alice doesn't have enough power
		setPowerLevel(
			createPowerLevel({
				events: {},
				users: {
					[alice]: 50,
					[bob]: 60,
				},
			}),
			secondState,
		);

		const newPowerLevel21 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
				[bob]: 0,
			},
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel21, secondState, store),
		).toThrow();

		// can remove bob's power level if alice has enough power
		setPowerLevel(
			createPowerLevel({
				events: {},
				users: {
					[alice]: 100,
					[bob]: 60,
				},
			}),
			secondState,
		);

		const newPowerLevel22 = createPowerLevel({
			events: {},
			users: {
				[alice]: 100,
				[bob]: 0,
			},
		});

		expect(() =>
			checkEventAuthWithState(newPowerLevel22, secondState, store),
		).not.toThrow();
	});
	// TODO: restricted rooms
});
