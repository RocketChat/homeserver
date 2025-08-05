import { getStateMapKey } from '../state_resolution/definitions/definitions';
import { StateMapKey } from '../types/_common';
import {
	PduCreateEventContent,
	PduJoinRuleEventContent,
	PduMembershipEventContent,
	PduPowerLevelsEventContent,
	PduRoomNameEventContent,
	PduTypeRoomCreate,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomName,
	PduTypeRoomPowerLevels,
	PduTypeRoomTopic,
} from '../types/v3-11';
import { type PersistentEventBase } from './event-wrapper';
import { RoomVersion } from './type';

export class RoomState {
	constructor(
		private readonly stateMap: Map<StateMapKey, PersistentEventBase>,
	) {}

	// who created the room
	get creator() {
		const createEvent = this.stateMap.get(
			getStateMapKey({ type: PduTypeRoomCreate }),
		);
		if (!createEvent) {
			throw new Error('Room create event not found');
		}

		return createEvent.getContent<PduCreateEventContent>().creator;
	}

	getUserMembership(
		userId: string,
	): PduMembershipEventContent['membership'] | undefined {
		const membershipEvent = this.stateMap.get(
			getStateMapKey({ type: PduTypeRoomMember, state_key: userId }),
		);
		if (!membershipEvent) {
			return undefined; // never been a member
		}

		return membershipEvent.getContent<PduMembershipEventContent>().membership;
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
		const nameEvent = this.stateMap.get(
			getStateMapKey({ type: PduTypeRoomName }),
		);
		if (!nameEvent) {
			throw new Error('Room name event not found');
		}

		return nameEvent.getContent<PduRoomNameEventContent>().name;
	}

	// room privacy
	get privacy(): PduJoinRuleEventContent['join_rule'] {
		const joinRuleEvent = this.stateMap.get(
			getStateMapKey({ type: PduTypeRoomJoinRules }),
		);
		if (!joinRuleEvent) {
			return 'public'; // default TODO: check this if is correct
		}

		return joinRuleEvent.getContent<PduJoinRuleEventContent>().join_rule;
	}

	isInviteOnly() {
		return this.privacy === 'invite';
	}

	isPublic() {
		return this.privacy === 'public';
	}

	isPrivate() {
		return this.privacy === 'private';
	}

	get topic() {
		const topicEvent = this.stateMap.get(
			getStateMapKey({ type: PduTypeRoomTopic }),
		);
		if (!topicEvent) {
			return '';
		}

		return '';
		// return topicEvent.getContent<PduRoomTopicEventContent>().topic;
	}

	get origin() {
		const createEvent = this.stateMap.get(
			getStateMapKey({ type: PduTypeRoomCreate }),
		);
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
		const powerLevelsEvent = this.stateMap.get(
			getStateMapKey({ type: PduTypeRoomPowerLevels }),
		);
		if (!powerLevelsEvent) {
			return undefined;
		}

		return powerLevelsEvent.getContent<PduPowerLevelsEventContent>();
	}

	get version() {
		const createEvent = this.stateMap.get(
			getStateMapKey({ type: PduTypeRoomCreate }),
		);
		if (!createEvent) {
			throw new Error('Room create event not found');
		}

		return createEvent.getContent<PduCreateEventContent>()
			.room_version as RoomVersion;
	}
}
