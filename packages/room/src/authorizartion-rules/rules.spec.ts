import { afterEach, describe, expect, it } from 'bun:test';

import { StateResolverAuthorizationError } from './errors';
import { checkEventAuthWithState, checkEventAuthWithoutState } from './rules';
import type { PersistentEventBase } from '../manager/event-wrapper';
import { PersistentEventFactory } from '../manager/factory';
import type { RoomVersion } from '../manager/type';
import { type EventStore, getStateMapKey } from '../state_resolution/definitions/definitions';
import { type StateMapKey } from '../types/_common';
import type { Pdu, PduContent, type PduType } from '../types/v3-11';

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

class FakeEventCreatorBase {
	protected _event!: Pdu;

	constructor() {
		this._event = {
			content: {},
			type: '',
			auth_events: [],
			prev_events: [],
			room_id: '',
			sender: '',
		} as unknown as Pdu;
	}

	withStateKey(stateKey: string) {
		this._event.state_key = stateKey;
		return this;
	}

	withType(type: PduType | 'test') {
		// @ts-expect-error breaking due to type and content conflict, doesn't matter here
		this._event.type = type;
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

	// a v12 create event has no room_id, the room id is derived from its hash
	withoutRoomId() {
		delete (this._event as Partial<Pdu>).room_id;
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

	build(roomVersion: RoomVersion = '10') {
		return PersistentEventFactory.createFromRawEvent(this._event, roomVersion);
	}
}

class FakeStateEventCreator extends FakeEventCreatorBase {
	constructor() {
		super();
		this._event.state_key = ''; // state events always have state_key
	}
}

class FakeTimelineEventCreator extends FakeEventCreatorBase {
	constructor() {
		super();
		// timeline events don't have state_key
	}
}

class FakeMessageEventCreator extends FakeTimelineEventCreator {
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
	const create = new FakeStateEventCreator().asRoomCreate().withRoomId(roomId).withSender(creator).withContent({ creator }).build();

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
	return new Map<StateMapKey, PersistentEventBase>(events.map((event) => [getStateMapKey(event.event), event]));
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

		expect(() => checkEventAuthWithoutState(randomEvent, [create, join])).not.toThrow();

		const joinRules = new FakeStateEventCreator()
			.asRoomJoinRules()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({
				join_rule: 'invite',
			})
			.build();

		expect(() => checkEventAuthWithoutState(randomEvent, [create, join, joinRules])).toThrow();
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
		expect(() => checkEventAuthWithoutState(randomEvent, [create, join])).not.toThrow();

		// random event2
		const randomEvent2 = new FakeStateEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({})
			.withStateKey(creator)
			.build();

		// should be rejected
		expect(() => checkEventAuthWithoutState(randomEvent2, [create, join, join])).toThrow();
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

		expect(() => checkEventAuthWithoutState(goodEvent, [create, join, powerLevel])).not.toThrow();

		expect(() => checkEventAuthWithoutState(badEvent, [create, join, powerLevel, joinRules])).toThrow();
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

		const randomStateEvent = new FakeStateEventCreator().asTest().withRoomId(roomId).withSender(creator).withContent({}).build();

		// creator should be able to send any event
		expect(() => checkEventAuthWithState(randomStateEvent, currentState, store)).not.toThrow();

		const randomEventSentByAlice = new FakeStateEventCreator().asTest().withRoomId(roomId).withSender(alice).withContent({}).build();

		expect(() => checkEventAuthWithState(randomEventSentByAlice, currentState, store)).toThrow();
	});

	it('06 users below events_default should not be able to send unknown events', async () => {
		const alice = '@alice:example.com';
		const bob = '@bob:example.com';

		const { create, join, powerLevel } = getInitialEvents(
			{},
			{
				events: {},
				events_default: 30,
				state_default: 50,
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

		const randomEvent = new FakeTimelineEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(alice) // should not be able to send (power 29 < events_default 30)
			.withContent({})
			.build();

		expect(() => checkEventAuthWithState(randomEvent, state, store)).toThrow();
		const randomEvent2 = new FakeTimelineEventCreator()
			.asTest()
			.withRoomId(roomId)
			.withSender(bob) // should be able to send state
			.withContent({})
			.build();

		expect(() => checkEventAuthWithState(randomEvent2, state, store)).not.toThrow();
	});

	// TODO: alias rooms
	it('07 joining rooms', async () => {
		const { create, join, /* powerLevel,*/ joinRules } = getInitialEvents({
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
		expect(() => checkEventAuthWithState(joinAlice, state, store)).not.toThrow();
		// expect(joinAlice.rejected).toBe(false);

		// user can not be forced to join the room
		const forceJoinAliceByCreator = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		expect(() => checkEventAuthWithState(forceJoinAliceByCreator, state, store)).toThrow();
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

		expect(() => checkEventAuthWithState(joinAlice, stateWithBan, store)).toThrow();
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

		expect(() => checkEventAuthWithState(joinAlice, stateWithLeave, store)).not.toThrow();

		// a user can send a join if in the room
		const stateWithAlice = getStateMap([create, join, joinRules, joinAlice]);

		expect(() => checkEventAuthWithState(joinAlice, stateWithAlice, store)).not.toThrow();

		// a user can accept an invite
		const inviteAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'invite' })
			.withStateKey(alice)
			.build();

		const stateWithInvite = getStateMap([create, join, joinRules, inviteAlice]);

		expect(() => checkEventAuthWithState(joinAlice, stateWithInvite, store)).not.toThrow();

		// should not be able to join if private
		const privateJoinRules = new FakeStateEventCreator()
			.asRoomJoinRules()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ join_rule: 'private' })
			.build();

		const stateWithPrivateJoinRules = getStateMap([create, join, privateJoinRules]);

		expect(() => checkEventAuthWithState(joinAlice, stateWithPrivateJoinRules, store)).toThrow();
	});

	it('08 test joining an invite only room', async () => {
		const { create, join, /* powerLevel,*/ joinRules } = getInitialEvents({
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

		expect(() => checkEventAuthWithState(forceJoinAliceByCreator, state, store)).toThrow();

		// banned should be rejected
		const banAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'ban' })
			.withStateKey(alice)
			.build();

		const stateWithBan = getStateMap([create, join, joinRules, banAlice]);

		expect(() => checkEventAuthWithState(joinAlice, stateWithBan, store)).toThrow();

		// who left should not be able to rejoin
		const leaveAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'leave' })
			.withStateKey(alice)
			.build();

		const stateWithLeave = getStateMap([create, join, joinRules, leaveAlice]);

		expect(() => checkEventAuthWithState(joinAlice, stateWithLeave, store)).toThrow();

		// in the room === can "join"
		const stateWithAlice = getStateMap([create, join, joinRules, joinAlice]);

		expect(() => checkEventAuthWithState(joinAlice, stateWithAlice, store)).not.toThrow();

		// invite should be allowed to be accepted
		const inviteAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ membership: 'invite' })
			.withStateKey(alice)
			.build();

		const stateWithInvite = getStateMap([create, join, joinRules, inviteAlice]);

		expect(() => checkEventAuthWithState(joinAlice, stateWithInvite, store)).not.toThrow();
	});

	it('09 should not allow custom event sending if power level is too low', async () => {
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

		// alice should not be able to send custom event if power < events_default (50)
		const state49 = setAlicePower(49);

		const randomEvent = new FakeTimelineEventCreator().asTest().withRoomId(roomId).withSender(alice).withContent({}).build();

		expect(checkEventAuthWithState(randomEvent, state49, store)).rejects.toThrow();

		// alice should be able to send custom event if power >= events_default (50)
		const state50 = setAlicePower(50);

		await checkEventAuthWithState(randomEvent, state50, store);

		// should not be able to send a message if power < 50
		const state49_message = setAlicePower(49);

		const messageEvent = new FakeMessageEventCreator().withRoomId(roomId).withSender(alice).withContent({}).build();

		expect(checkEventAuthWithState(messageEvent, state49_message, store)).rejects.toThrow();

		const state51 = setAlicePower(51);

		await checkEventAuthWithState(messageEvent, state51, store);

		// setting custom power required for test events
		const randomEvent2 = new FakeStateEventCreator().asTest().withRoomId(roomId).withSender(alice).withContent({}).build();

		const stateX = (() => {
			const { create, join, powerLevel, joinRules } = getInitialEvents(
				{
					joinRule: 'public',
				},
				{
					events: {
						[randomEvent2.type]: 100,
					},
					users: {
						[alice]: 51, // alice should not be able to send randomEvent2 (requires 100)
					},

					state_default: 30,
				},
			);

			return getStateMap([create, join, powerLevel, joinRules, joinAlice]);
		})();

		expect(checkEventAuthWithState(randomEvent2, stateX, store)).rejects.toThrow();

		// setting custom power required for test events
		const stateY = (() => {
			const { create, join, powerLevel, joinRules } = getInitialEvents(
				{
					joinRule: 'public',
				},
				{
					events: {
						[randomEvent2.type]: 50,
					},
					users: {
						[alice]: 51, // alice should be able to send randomEvent2 (requires 50, has 51)
					},
				},
			);

			return getStateMap([create, join, powerLevel, joinRules, joinAlice]);
		})();

		await checkEventAuthWithState(randomEvent2, stateY, store);
	});

	it('09.1 should use events_default for custom and unknown Matrix events', async () => {
		const alice = '@alice:example.com';

		const joinAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		const { create, join, powerLevel, joinRules } = getInitialEvents(
			{ joinRule: 'public' },
			{
				events: {},
				users: {
					[alice]: 40,
				},
				state_default: 50, // state events need 50
				events_default: 30, // unknown/custom events need 30
			},
		);

		const state = getStateMap([create, join, powerLevel, joinRules, joinAlice]);

		// test custom application event (io.rocketchat.*)
		const customRocketChatEvent = new FakeTimelineEventCreator()
			// @ts-expect-error - testing unknown event type
			.withType('io.rocketchat.custom')
			.withRoomId(roomId)
			.withSender(alice) // power 40 >= events_default 30, should pass
			.withContent({})
			.build();

		await checkEventAuthWithState(customRocketChatEvent, state, store);

		// test another custom event (com.example.*)
		const customExampleEvent = new FakeTimelineEventCreator()
			// @ts-expect-error - testing unknown event type
			.withType('com.example.event')
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({})
			.build();

		await checkEventAuthWithState(customExampleEvent, state, store);

		// test unknown Matrix standard event (m.poll.start)
		const unknownMatrixEvent = new FakeTimelineEventCreator()
			// @ts-expect-error - testing unknown event type
			.withType('m.poll.start')
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({})
			.build();

		await checkEventAuthWithState(unknownMatrixEvent, state, store);

		// verify that power < events_default fails for custom events
		const {
			create: create2,
			join: join2,
			powerLevel: powerLevel2,
			joinRules: joinRules2,
		} = getInitialEvents(
			{ joinRule: 'public' },
			{
				events: {},
				users: {
					[alice]: 25, // power 25 < events_default 30, should fail
				},
				state_default: 50,
				events_default: 30,
			},
		);

		const state2 = getStateMap([create2, join2, powerLevel2, joinRules2, joinAlice]);

		const customEventLowPower = new FakeTimelineEventCreator()
			// @ts-expect-error - testing unknown event type
			.withType('io.rocketchat.test')
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({})
			.build();

		expect(checkEventAuthWithState(customEventLowPower, state2, store)).rejects.toThrow();
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
		expect(() => checkEventAuthWithState(existingPowerLevel, initialState, store)).not.toThrow();

		const alice = '@alice:example.com';

		const joinAlice = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(alice)
			.withContent({ membership: 'join' })
			.withStateKey(alice)
			.build();

		const secondState = getStateMap([create, join, joinRules, existingPowerLevel, joinAlice]);

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

		const setPowerLevel = (powerLevel: PersistentEventBase, state: typeof secondState) => {
			state.set(powerLevel.getUniqueStateIdentifier(), powerLevel);
		};

		const createPowerLevel = (content: PduContent) => {
			return new FakeStateEventCreator().asPowerLevel().withRoomId(roomId).withSender(alice).withContent(content).build();
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
		expect(() => checkEventAuthWithState(newPowerLevel, secondState, store)).toThrow();

		const newPowerLevel2 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			users_default: 30,
		});

		// reducing
		expect(() => checkEventAuthWithState(newPowerLevel2, secondState, store)).not.toThrow();

		// events_default

		// should not be able to increase events_default if doesn't have enough power
		const newPowerLevel3 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			events_default: 60,
		});

		expect(() => checkEventAuthWithState(newPowerLevel3, secondState, store)).toThrow();

		const newPowerLevel4 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			events_default: 40, // should be able to reduce events_default
		});

		expect(() => checkEventAuthWithState(newPowerLevel4, secondState, store)).not.toThrow();

		// state_default

		const newPowerLevel5 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			state_default: 60,
		});

		expect(() => checkEventAuthWithState(newPowerLevel5, secondState, store)).toThrow();

		const newPowerLevel6 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			state_default: 40,
		});

		expect(() => checkEventAuthWithState(newPowerLevel6, secondState, store)).not.toThrow();

		const newPowerLevel7 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			ban: 60,
		});

		expect(() => checkEventAuthWithState(newPowerLevel7, secondState, store)).toThrow();

		const newPowerLevel8 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			ban: 40,
		});

		expect(() => checkEventAuthWithState(newPowerLevel8, secondState, store)).not.toThrow();

		// kick
		const newPowerLevel9 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			kick: 60,
		});

		expect(() => checkEventAuthWithState(newPowerLevel9, secondState, store)).toThrow();

		const newPowerLevel10 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			kick: 40,
		});

		expect(() => checkEventAuthWithState(newPowerLevel10, secondState, store)).not.toThrow();

		// invite
		const newPowerLevel11 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			invite: 60,
		});

		expect(() => checkEventAuthWithState(newPowerLevel11, secondState, store)).toThrow();

		const newPowerLevel12 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			invite: 40,
		});

		expect(() => checkEventAuthWithState(newPowerLevel12, secondState, store)).not.toThrow();

		// redact
		const newPowerLevel13 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			redact: 60,
		});

		expect(() => checkEventAuthWithState(newPowerLevel13, secondState, store)).toThrow();

		const newPowerLevel14 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
			},
			redact: 40,
		});

		expect(() => checkEventAuthWithState(newPowerLevel14, secondState, store)).not.toThrow();

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
		expect(() => checkEventAuthWithState(newPowerLevel15, secondState, store)).toThrow();

		// 'test' is added with lower power level than alice's current power level, allow
		const newPowerLevel16 = createPowerLevel({
			events: {
				test: 50,
			},
			users: {
				[alice]: 50,
			},
		});

		expect(() => checkEventAuthWithState(newPowerLevel16, secondState, store)).not.toThrow();

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

		expect(() => checkEventAuthWithState(newPowerLevel17, secondState, store)).not.toThrow();

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
		expect(() => checkEventAuthWithState(newPowerLevel18, secondState, store)).toThrow();

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

		expect(() => checkEventAuthWithState(newPowerLevel19, secondState, store)).toThrow();

		// can reduce bob's power level if alice has enough power
		const newPowerLevel20 = createPowerLevel({
			events: {},
			users: {
				[alice]: 50,
				[bob]: 40,
			},
		});

		expect(() => checkEventAuthWithState(newPowerLevel20, secondState, store)).not.toThrow();

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

		expect(() => checkEventAuthWithState(newPowerLevel21, secondState, store)).toThrow();

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

		expect(() => checkEventAuthWithState(newPowerLevel22, secondState, store)).not.toThrow();
	});
	// TODO: restricted rooms

	it('should tolerate missing power level event for membership change', async () => {
		const { create, join, joinRules, powerLevel } = getInitialEvents({
			joinRule: 'public',
		});

		store.events.delete(powerLevel.eventId);

		const state = getStateMap([create, join, joinRules]);

		// try to join
		const bob = '@bob:example.com';

		const joinBob = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withSender(bob)
			.withContent({ membership: 'join' })
			.withStateKey(bob)
			.build();

		expect(() => checkEventAuthWithState(joinBob, state, store)).not.toThrow();
	});

	it('should tolerate missing power level event for power level change', async () => {
		const { create, join, joinRules, powerLevel } = getInitialEvents({
			joinRule: 'public',
		});

		store.events.delete(powerLevel.eventId);

		const state = getStateMap([create, join, joinRules]);

		// try to join
		const pl2 = new FakeStateEventCreator()
			.asPowerLevel()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({
				events: {},
				users: {
					[creator]: 100,
				},
				users_default: 0,
				state_default: 50,
			})
			.build();

		// should allow since no existing is there
		expect(() => checkEventAuthWithState(pl2, state, store)).not.toThrow();

		const state2 = getStateMap([create, join, joinRules, pl2]);

		store.events.set(pl2.eventId, pl2);

		const pl3 = new FakeStateEventCreator()
			.asPowerLevel()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({
				events: {},
				users: {
					[creator]: 100,
				},
				users_default: 0,
				state_default: 100, // trying to increase
			})
			.build();

		// should still allow
		expect(() => checkEventAuthWithState(pl3, state2, store)).not.toThrow();
	});

	it('should accept a v11 create event without content.creator', async () => {
		const create = new FakeStateEventCreator()
			.asRoomCreate()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ room_version: '11' })
			.build('11');

		expect(() => checkEventAuthWithoutState(create, [])).not.toThrow();
	});

	it("should allow the room creator's first join in a v11 room", async () => {
		const create = new FakeStateEventCreator()
			.asRoomCreate()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ room_version: '11' })
			.build('11');

		store.events.set(create.eventId, create);

		// no join_rules event yet, so only the creator allowance can let this through
		const join = new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomId)
			.withStateKey(creator)
			.withSender(creator)
			.withContent({ membership: 'join' })
			.withLastEvent(create)
			.build('11');

		await expect(checkEventAuthWithState(join, getStateMap([create]), store)).resolves.toBeUndefined();
	});

	it('should still require content.creator before v11', async () => {
		const create = new FakeStateEventCreator()
			.asRoomCreate()
			.withRoomId(roomId)
			.withSender(creator)
			.withContent({ room_version: '10' })
			.build('10');

		expect(() => checkEventAuthWithoutState(create, [])).toThrow();
	});
});

describe('authorization rules: room v12', () => {
	afterEach(() => store.events.clear());

	const bob = '@bob:example.com';
	const carol = '@carol:example.com';
	const dave = '@dave:example.com';

	function createEvent(content: Record<string, unknown> = { room_version: '12' }) {
		return new FakeStateEventCreator().asRoomCreate().withoutRoomId().withSender(creator).withContent(content).build('12');
	}

	// a v12 room: no event lists the create event, it is found through the room id instead
	function v12Room({
		additionalCreators,
		powerLevels = { users: { [bob]: 100 }, users_default: 0, events: {} },
	}: { additionalCreators?: string[]; powerLevels?: Record<string, unknown> } = {}) {
		const create = createEvent({ room_version: '12', ...(additionalCreators && { additional_creators: additionalCreators }) });
		store.events.set(create.eventId, create);

		const v12RoomId = create.roomId;

		const state = (type: 'm.room.member' | 'm.room.power_levels' | 'm.room.join_rules', content: unknown, stateKey = '') =>
			new FakeStateEventCreator()
				.withType(type)
				.withRoomId(v12RoomId)
				.withSender(creator)
				.withStateKey(stateKey)
				.withContent(content)
				.build('12');

		const members = [creator, bob, carol, dave].map((userId) => state('m.room.member', { membership: 'join' }, userId));
		const powerLevel = state('m.room.power_levels', powerLevels);
		const joinRules = state('m.room.join_rules', { join_rule: 'public' });

		for (const event of [...members, powerLevel, joinRules]) {
			store.events.set(event.eventId, event);
		}

		// deliberately without the create event, from v12 auth never takes it from the state map
		const stateMap = getStateMap([...members, powerLevel, joinRules]);

		return { create, roomId: v12RoomId, members, powerLevel, joinRules, stateMap };
	}

	function member(roomIdOfEvent: string, sender: string, target: string, membership: string) {
		return new FakeStateEventCreator()
			.asRoomMember()
			.withRoomId(roomIdOfEvent)
			.withSender(sender)
			.withStateKey(target)
			.withContent({ membership })
			.build('12');
	}

	describe('m.room.create', () => {
		it('derives the room id from the create event hash', () => {
			const create = createEvent();

			expect(create.event.room_id).toBeUndefined();
			expect(create.roomId).toBe(`!${create.eventId.slice(1)}`);
			expect(create.roomId).toMatch(/^![A-Za-z0-9_-]{43}$/);
		});

		it('accepts a create event without room_id (rule 1.2)', () => {
			expect(() => checkEventAuthWithoutState(createEvent(), [])).not.toThrow();
		});

		it('rejects a create event with a room_id (rule 1.2)', () => {
			const create = new FakeStateEventCreator()
				.asRoomCreate()
				.withRoomId(roomId)
				.withSender(creator)
				.withContent({ room_version: '12' })
				.build('12');

			expect(() => checkEventAuthWithoutState(create, [])).toThrow(StateResolverAuthorizationError);
		});

		it('still rejects a v11 create event without room_id', () => {
			const create = new FakeStateEventCreator()
				.asRoomCreate()
				.withoutRoomId()
				.withSender(creator)
				.withContent({ room_version: '11' })
				.build('11');

			expect(() => checkEventAuthWithoutState(create, [])).toThrow(StateResolverAuthorizationError);
		});

		it('accepts valid additional_creators (rule 1.4)', () => {
			expect(() => checkEventAuthWithoutState(createEvent({ room_version: '12', additional_creators: [bob, carol] }), [])).not.toThrow();
		});

		for (const [label, additionalCreators] of [
			['not an array', bob],
			['a non string entry', [bob, 42]],
			['an invalid user id', ['bob']],
			['a user id without a server', ['@bob']],
		] as const) {
			it(`rejects additional_creators with ${label} (rule 1.4)`, () => {
				expect(() => checkEventAuthWithoutState(createEvent({ room_version: '12', additional_creators: additionalCreators }), [])).toThrow(
					StateResolverAuthorizationError,
				);
			});
		}
	});

	describe('auth events', () => {
		it('rejects an event listing m.room.create in auth_events (rule 3.2)', () => {
			const { create, roomId: v12RoomId, members, powerLevel } = v12Room();
			const message = new FakeMessageEventCreator()
				.withRoomId(v12RoomId)
				.withSender(bob)
				.withContent({ msgtype: 'm.text', body: 'hi' })
				.authedBy(create)
				.authedBy(powerLevel)
				.authedBy(members[1])
				.build('12');

			expect(() => checkEventAuthWithoutState(message, [create, powerLevel, members[1]])).toThrow('m.room.create must not be listed');
		});

		it('does not require m.room.create among the auth_events', () => {
			const { roomId: v12RoomId, members, powerLevel } = v12Room();
			const message = new FakeMessageEventCreator()
				.withRoomId(v12RoomId)
				.withSender(bob)
				.withContent({ msgtype: 'm.text', body: 'hi' })
				.authedBy(powerLevel)
				.authedBy(members[1])
				.build('12');

			expect(() => checkEventAuthWithoutState(message, [powerLevel, members[1]])).not.toThrow();
		});

		it('rejects an auth event from another room (rule 3.4)', () => {
			const { roomId: v12RoomId, powerLevel } = v12Room();
			const foreignMember = new FakeStateEventCreator()
				.asRoomMember()
				.withRoomId(roomId)
				.withSender(bob)
				.withStateKey(bob)
				.withContent({ membership: 'join' })
				.build('12');

			const message = new FakeMessageEventCreator()
				.withRoomId(v12RoomId)
				.withSender(bob)
				.withContent({ msgtype: 'm.text', body: 'hi' })
				.authedBy(powerLevel)
				.authedBy(foreignMember)
				.build('12');

			expect(() => checkEventAuthWithoutState(message, [powerLevel, foreignMember])).toThrow('different room');
		});

		it('rejects an event whose room id matches no known create event (rule 2)', async () => {
			const { stateMap } = v12Room();
			const unknownRoomId = `!${'A'.repeat(43)}`;
			const message = new FakeMessageEventCreator()
				.withRoomId(unknownRoomId)
				.withSender(bob)
				.withContent({ msgtype: 'm.text', body: 'hi' })
				.build('12');

			await expect(checkEventAuthWithState(message, stateMap, store)).rejects.toThrow('does not correspond to a known m.room.create');
		});

		it('rejects an event whose create event was rejected (rule 2)', async () => {
			const { create, roomId: v12RoomId, stateMap } = v12Room();
			create.reject('auth_error', 'test');
			const message = new FakeMessageEventCreator()
				.withRoomId(v12RoomId)
				.withSender(bob)
				.withContent({ msgtype: 'm.text', body: 'hi' })
				.build('12');

			await expect(checkEventAuthWithState(message, stateMap, store)).rejects.toThrow('was rejected');
		});

		it('authorizes against a state map without m.room.create', async () => {
			const { roomId: v12RoomId, stateMap } = v12Room();
			const message = new FakeMessageEventCreator()
				.withRoomId(v12RoomId)
				.withSender(bob)
				.withContent({ msgtype: 'm.text', body: 'hi' })
				.build('12');

			await expect(checkEventAuthWithState(message, stateMap, store)).resolves.toBeUndefined();
		});

		it('rejects with an authorization error, not a crash, when a v11 room has no create event', async () => {
			const member11 = new FakeStateEventCreator()
				.asRoomMember()
				.withRoomId(roomId)
				.withSender(bob)
				.withStateKey(bob)
				.withContent({ membership: 'join' })
				.build('11');
			const message = new FakeMessageEventCreator()
				.withRoomId(roomId)
				.withSender(bob)
				.withContent({ msgtype: 'm.text', body: 'hi' })
				.build('11');

			await expect(checkEventAuthWithState(message, getStateMap([member11]), store)).rejects.toBeInstanceOf(
				StateResolverAuthorizationError,
			);
		});
	});

	describe('power levels', () => {
		function powerLevelsEvent(v12RoomId: string, users: Record<string, number>) {
			return new FakeStateEventCreator()
				.asPowerLevel()
				.withRoomId(v12RoomId)
				.withSender(creator)
				.withContent({ users, users_default: 0, events: {} })
				.build('12');
		}

		it('rejects power levels listing the create sender in users (rule 10.4)', async () => {
			const { roomId: v12RoomId, stateMap } = v12Room();

			await expect(checkEventAuthWithState(powerLevelsEvent(v12RoomId, { [creator]: 100 }), stateMap, store)).rejects.toThrow(
				'must not be listed in power level users',
			);
		});

		it('rejects power levels listing an additional creator in users (rule 10.4)', async () => {
			const { roomId: v12RoomId, stateMap } = v12Room({ additionalCreators: [carol] });

			await expect(checkEventAuthWithState(powerLevelsEvent(v12RoomId, { [carol]: 50 }), stateMap, store)).rejects.toThrow(
				'must not be listed in power level users',
			);
		});

		it('accepts power levels that do not list any creator', async () => {
			const { roomId: v12RoomId, stateMap } = v12Room({ additionalCreators: [carol] });

			await expect(
				checkEventAuthWithState(powerLevelsEvent(v12RoomId, { [bob]: 100, [dave]: 50 }), stateMap, store),
			).resolves.toBeUndefined();
		});
	});

	describe('privileged creators', () => {
		it('lets an additional creator send events of any required level without a users entry', async () => {
			const { roomId: v12RoomId, stateMap } = v12Room({
				additionalCreators: [carol],
				powerLevels: { users: {}, users_default: 0, events: { 'm.room.name': 100 } },
			});
			const name = (sender: string) =>
				new FakeStateEventCreator().withType('m.room.name').withRoomId(v12RoomId).withSender(sender).withContent({ name: 'x' }).build('12');

			await expect(checkEventAuthWithState(name(carol), stateMap, store)).resolves.toBeUndefined();
			await expect(checkEventAuthWithState(name(dave), stateMap, store)).rejects.toBeInstanceOf(StateResolverAuthorizationError);
		});

		it('does not let a PL 100 user kick or ban a creator', async () => {
			const { roomId: v12RoomId, stateMap } = v12Room({ additionalCreators: [carol] });

			await expect(checkEventAuthWithState(member(v12RoomId, bob, creator, 'leave'), stateMap, store)).rejects.toThrow('kick level');
			await expect(checkEventAuthWithState(member(v12RoomId, bob, carol, 'ban'), stateMap, store)).rejects.toThrow('ban level');
		});

		it('lets a creator kick and ban a PL 100 user', async () => {
			const { roomId: v12RoomId, stateMap } = v12Room({ additionalCreators: [carol] });

			await expect(checkEventAuthWithState(member(v12RoomId, creator, bob, 'leave'), stateMap, store)).resolves.toBeUndefined();
			await expect(checkEventAuthWithState(member(v12RoomId, carol, bob, 'ban'), stateMap, store)).resolves.toBeUndefined();
		});

		it("allows the room creator's first join", async () => {
			const create = createEvent();
			store.events.set(create.eventId, create);

			const join = new FakeStateEventCreator()
				.asRoomMember()
				.withRoomId(create.roomId)
				.withStateKey(creator)
				.withSender(creator)
				.withContent({ membership: 'join' })
				.withLastEvent(create)
				.build('12');

			await expect(checkEventAuthWithState(join, new Map(), store)).resolves.toBeUndefined();
		});
	});
});
