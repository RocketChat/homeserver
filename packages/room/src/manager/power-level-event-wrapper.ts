import {
	PduTypeRoomMessage,
	type PduPowerLevelsEventContent,
	type PduType,
} from '../types/v1';
import type { PduPowerLevelsEventV3Content } from '../types/v3';
import type { PduPowerLevelsEventV10Content } from '../types/v10';
import { PersistentEventBase } from './event-wrapper';

// centralize all power level values here
// whether there is an event or not
// all defaults and transformations according to diff versions of pdus

class PowerLevelEvent {
	private readonly _content?:
		| PduPowerLevelsEventContent
		| PduPowerLevelsEventV3Content
		| PduPowerLevelsEventV10Content;

	static fromEvent(event?: PersistentEventBase) {
		return new PowerLevelEvent(event);
	}

	constructor(private readonly event?: PersistentEventBase) {
		this._content = event?.getContent() as
			| PduPowerLevelsEventContent
			| PduPowerLevelsEventV3Content
			| PduPowerLevelsEventV10Content;
	}

	transform(data: number | string): number {
		if (this.event) {
			return this.event.transformPowerLevelEventData(data);
		}

		// only called when there is an event / content with a value

		return Number.MIN_SAFE_INTEGER; // unreachable
	}

	toEventBase() {
		return this.event;
	}

	// power level event accessors
	getRequiredPowerForInvite() {
		if (!this._content) {
			return 0;
		}

		return this._content.invite ? this.transform(this._content.invite) : 0;
	}

	getRequiredPowerForKick() {
		if (!this._content) {
			return 50;
		}

		return this._content.kick ? this.transform(this._content.kick) : 50;
	}

	getRequiredPowerForBan() {
		if (!this._content) {
			return 50;
		}

		return this._content.ban ? this.transform(this._content.ban) : 50;
	}

	getRequiredPowerForRedact() {
		if (!this._content) {
			return 50;
		}

		return this._content.redact ? this.transform(this._content.redact) : 50;
	}

	getPowerLevelForUser(userId: string, createEvent?: PersistentEventBase) {
		if (!this._content) {
			if (createEvent?.sender === userId) {
				return 100;
			}

			return 0;
		}

		if (this._content.users?.[userId]) {
			return this.transform(this._content.users[userId]);
		}

		if (this._content.users_default) {
			return this.transform(this._content.users_default);
		}

		return createEvent?.sender === userId ? 100 : 0;
	}

	getRequiredPowerLevelForEvent(type: PduType) {
		if (!this._content) {
			if (type === PduTypeRoomMessage) {
				return 0;
			}

			return 50;
		}

		if (this._content.events?.[type]) {
			return this.transform(this._content.events[type]);
		}

		if (type === PduTypeRoomMessage) {
			return this._content.events_default
				? this.transform(this._content.events_default)
				: 0;
		}

		// state events
		return this._content.state_default
			? this.transform(this._content.state_default)
			: 50;
	}

	// raw transformed values
	//
	getPowerLevelBanValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.ban ? this.transform(this._content.ban) : undefined;
	}

	getPowerLevelKickValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.kick ? this.transform(this._content.kick) : undefined;
	}

	getPowerLevelInviteValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.invite
			? this.transform(this._content.invite)
			: undefined;
	}

	getPowerLevelRedactValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.redact
			? this.transform(this._content.redact)
			: undefined;
	}

	getPowerLevelEventsDefaultValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.events_default
			? this.transform(this._content.events_default)
			: undefined;
	}

	getPowerLevelStateDefaultValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.state_default
			? this.transform(this._content.state_default)
			: undefined;
	}

	// users_default
	getPowerLevelUserDefaultValue() {
		if (!this._content) {
			return undefined;
		}

		return this._content.users_default
			? this.transform(this._content.users_default)
			: undefined;
	}

	getPowerLevelEventsValue(type: PduType) {
		if (!this._content) {
			return undefined;
		}

		return this._content.events?.[type]
			? this.transform(this._content.events[type])
			: undefined;
	}

	getPowerLevelUsersValue(userId: string) {
		if (!this._content) {
			return undefined;
		}

		return this._content.users?.[userId]
			? this.transform(this._content.users[userId])
			: undefined;
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
