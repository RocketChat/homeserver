import { getStateByMapKey } from '../state_resolution/definitions/definitions';
import { StateMapKey } from '../types/_common';
import {
	PduCreateEventContent,
	PduJoinRuleEventContent,
	PduMembershipEventContent,
	PduPowerLevelsEventContent,
	PduRoomNameEventContent,
	PduRoomTopicEventContent,
} from '../types/v3-11';
import { type PersistentEventBase } from './event-wrapper';
import { RoomVersion } from './type';

// RoomState is an accessor to help with accessing room properties from internal state representation which is essentially a map (see adrs for more information)
export class RoomState {
	constructor(
		private readonly stateMap: Map<StateMapKey, PersistentEventBase>,
	) {}

	// who created the room
	get creator() {
		const createEvent = getStateByMapKey(this.stateMap, {
			type: 'm.room.create',
		});

		if (!createEvent || !createEvent.isCreateEvent()) {
			throw new Error('Room create event not found');
		}

		return createEvent.getContent().creator;
	}

	getUserMembership(
		userId: string,
	): PduMembershipEventContent['membership'] | undefined {
		const membershipEvent = getStateByMapKey(this.stateMap, {
			type: 'm.room.member',
			state_key: userId,
		});
		if (!membershipEvent || !membershipEvent.isMembershipEvent()) {
			return undefined; // never been a member
		}

		return membershipEvent.getContent().membership;
	}

	isUserInRoom(userId: string): boolean {
		return this.getUserMembership(userId) !== undefined;
	}

	isUserKicked(userId: string): boolean {
		return this.getUserMembership(userId) === 'leave';
	}

	// wrong english, but for intellisense
	isUserLeft(userId: string): boolean {
		return this.getUserMembership(userId) === 'leave';
	}

	isUserKnocked(userId: string): boolean {
		return this.getUserMembership(userId) === 'knock';
	}

	isUserInvited(userId: string): boolean {
		return this.getUserMembership(userId) === 'invite';
	}

	// name of the room
	get name() {
		const nameEvent = getStateByMapKey(this.stateMap, {
			type: 'm.room.name',
		});
		if (!nameEvent || !nameEvent.isNameEvent()) {
			throw new Error('Room name event not found');
		}

		return nameEvent.getContent().name;
	}

	// room privacy
	get privacy(): PduJoinRuleEventContent['join_rule'] {
		const joinRuleEvent = getStateByMapKey(this.stateMap, {
			type: 'm.room.join_rules',
		});
		if (!joinRuleEvent || !joinRuleEvent.isJoinRuleEvent()) {
			return 'public'; // default TODO: check this if is correct
		}

		return joinRuleEvent.getContent().join_rule;
	}

	isInviteOnly() {
		return this.privacy === 'invite';
	}

	isPublic() {
		return this.privacy === 'public';
	}

	// shouldn't need this yet, rc doesn't understand this exactly
	isPrivate() {
		return this.privacy === 'private';
	}

	get topic() {
		const topicEvent = getStateByMapKey(this.stateMap, {
			type: 'm.room.topic',
		});
		if (!topicEvent || !topicEvent.isTopicEvent()) {
			return '';
		}

		return topicEvent.getContent().topic;
	}

	// origin is the origin of the room gotten from the room id
	get origin() {
		const createEvent = getStateByMapKey(this.stateMap, {
			type: 'm.room.create',
		});

		if (!createEvent) {
			throw new Error('Room create event not found');
		}

		const origin = createEvent.origin;
		if (!origin) {
			throw new Error('Room create event has no origin');
		}

		return origin;
	}

	get powerLevels() {
		const powerLevelsEvent = getStateByMapKey(this.stateMap, {
			type: 'm.room.power_levels',
		});

		if (!powerLevelsEvent || !powerLevelsEvent.isPowerLevelEvent()) {
			return undefined;
		}

		return powerLevelsEvent.getContent();
	}

	get version() {
		const createEvent = getStateByMapKey(this.stateMap, {
			type: 'm.room.create',
		});
		if (!createEvent || !createEvent.isCreateEvent()) {
			throw new Error('Room create event not found');
		}

		return createEvent.getContent().room_version;
	}
}
