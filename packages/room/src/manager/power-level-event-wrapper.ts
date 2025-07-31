import {
	type PduPowerLevelsEventContent,
	type PduType,
	isTimelineEventType,
} from '../types/v3-11';
import { PersistentEventBase } from './event-wrapper';

// centralize all power level values here
// whether there is an event or not
// all defaults and transformations according to diff versions of pdus

class PowerLevelEvent {
	private readonly _content?: PduPowerLevelsEventContent;

	static fromEvent(event?: PersistentEventBase) {
		return new PowerLevelEvent(event);
	}

	constructor(private readonly event?: PersistentEventBase) {
		this._content = event?.getContent();
	}

	toEventBase() {
		return this.event;
	}

	// power level event accessors
	getRequiredPowerForInvite() {
		if (!this._content) {
			return 0;
		}

		return this._content.invite ?? 0;
	}

	getRequiredPowerForKick() {
		if (!this._content) {
			return 50;
		}

		return this._content.kick ?? 50;
	}

	getRequiredPowerForBan() {
		if (!this._content) {
			return 50;
		}

		return this._content.ban ?? 50;
	}

	getRequiredPowerForRedact() {
		if (!this._content) {
			return 50;
		}

		return this._content.redact ?? 50;
	}

	getPowerLevelForUser(userId: string, createEvent?: PersistentEventBase) {
		if (!this._content) {
			if (createEvent?.sender === userId) {
				return 100;
			}

			return 0;
		}

		if (typeof this._content.users?.[userId] === 'number') {
			return this._content.users[userId];
		}

		if (typeof this._content.users_default === 'number') {
			return this._content.users_default;
		}

		return createEvent?.sender === userId ? 100 : 0;
	}

	getRequiredPowerLevelForEvent(type: PduType) {
		if (!this._content) {
			if (isTimelineEventType(type)) {
				return 0;
			}

			return 50;
		}

		if (typeof this._content.events?.[type] === 'number') {
			return this._content.events[type];
		}

		if (isTimelineEventType(type)) {
			return this._content.events_default ?? 0;
		}

		// state events
		return this._content.state_default ?? 50;
	}

	// raw transformed values
	//
	getPowerLevelBanValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.ban;
	}

	getPowerLevelKickValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.kick;
	}

	getPowerLevelInviteValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.invite;
	}

	getPowerLevelRedactValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.redact;
	}

	getPowerLevelEventsDefaultValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.events_default;
	}

	getPowerLevelStateDefaultValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.state_default;
	}

	// users_default
	getPowerLevelUserDefaultValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.users_default;
	}

	getPowerLevelEventsValue(type: PduType) {
		if (!this._content) {
			return undefined;
		}

		return this._content.events?.[type];
	}

	getPowerLevelUsersValue(userId: string) {
		if (!this._content) {
			return undefined;
		}

		return this._content.users?.[userId];
	}

	exists() {
		return !!this._content;
	}

	get sender() {
		if (!this.event) {
			throw new Error('PowerLevelEvent does not exist can not access sender');
		}

		return this.event.sender;
	}
}

export { PowerLevelEvent };
