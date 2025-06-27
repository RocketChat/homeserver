import { encodeCanonicalJson, toUnpaddedBase64 } from '@hs/core';
import type { StateMapKey } from '../types/_common';
import {
	PduTypeRoomCanonicalAlias,
	PduTypeRoomCreate,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomPowerLevels,
	type PduV1,
	type PduMembershipEventContent,
	type PduJoinRuleEventContent,
} from '../types/v1';
import type { PduV3 } from '../types/v3';
import crypto from 'node:crypto';
import { type PduV10 } from '../types/v10';
import {
	getStateMapKey,
	type EventStore,
} from '../state_resolution/definitions/definitions';
import type {
	RoomVersion,
	PduVersionForRoomVersionWithOnlyRequiredFields,
} from './type';
import { PowerLevelEvent } from './power-level-event-wrapper';

function extractDomain(identifier: string) {
	return identifier.split(':').pop();
}

// convinient wrapper to manage schema differences when working with same algorithms across different versions
export abstract class PersistentEventBase<T extends RoomVersion = RoomVersion> {
	private _rejectedReason?: string;

	constructor(
		protected readonly rawEvent: PduVersionForRoomVersionWithOnlyRequiredFields<T>,
		freeze = false,
	) {
		if (freeze) {
			this.freezeEvent();
		}
	}

	// at the point of calculating the reference hash, mark the internal reference as read only
	// once we have accessed the id of an event, the redacted event MUST NOT CHANGE
	// while it is allowed to change keys that are not part of the redaction algorithm, we will still freeze the full event for now.
	protected freezeEvent() {
		Object.freeze(this.rawEvent);
	}

	// don't recalculate the hash if it is already set
	get sha256hash() {
		if (!this.rawEvent.hashes) {
			this.rawEvent.hashes = {
				sha256: toUnpaddedBase64(this.getContentHash()),
			};
		}

		return this.rawEvent.hashes!.sha256;
	}

	get type() {
		return this.rawEvent.type;
	}

	get roomId() {
		return this.rawEvent.room_id;
	}

	get sender() {
		return this.rawEvent.sender;
	}

	get domain() {
		return extractDomain(this.rawEvent.sender);
	}

	get stateKey() {
		return this.rawEvent.state_key;
	}

	get originServerTs() {
		return this.rawEvent.origin_server_ts;
	}

	get event() {
		// don't change hash for now to not influence reference hash change
		// TODO: this doesn't sound right, but trying to be synapse compatible.
		if (this.rawEvent.hashes?.sha256) {
			// freeze any change to this event to lock in the reference hash
			this.freezeEvent();

			return {
				...this.rawEvent,
				unsigned: {},
			};
		}

		const event = {
			...this.rawEvent,
			hashes: {
				sha256: this.getContentHashString(),
			},
			unsigned: {}, // TODO better handling of this heh
		};

		// content hash has been calculated, so we can freeze the event
		this.freezeEvent();

		return event;
	}

	get depth() {
		return this.rawEvent.depth;
	}

	abstract get eventId(): string;

	getContent<T extends (PduV1 | PduV3 | PduV10)['content']>(): T {
		return this.rawEvent.content as T;
	}

	setContent<T extends (PduV1 | PduV3 | PduV10)['content']>(content: T) {
		this.rawEvent.content = content;
	}

	toPowerLevelEvent() {
		if (this.isPowerLevelEvent()) {
			return new PowerLevelEvent(this);
		}

		throw new Error('Event is not a power level event');
	}

	// room version dependent
	abstract getAuthorizationEvents(
		store: EventStore,
	): Promise<PersistentEventBase[]>;

	abstract getPreviousEvents(store: EventStore): Promise<PersistentEventBase[]>;

	abstract transformPowerLevelEventData(data: string | number): number;

	isState() {
		// spec wise this is the right way to check if an event is a state event
		return typeof this.rawEvent.state_key === 'string';
	}

	isPowerLevelEvent() {
		return this.isState() && this.type === PduTypeRoomPowerLevels;
	}

	isJoinRuleEvent() {
		return this.isState() && this.type === PduTypeRoomJoinRules;
	}

	isMembershipEvent() {
		return this.isState() && this.type === PduTypeRoomMember;
	}

	isCreateEvent() {
		return this.isState() && this.type === PduTypeRoomCreate;
	}

	isCanonicalAliasEvent() {
		return this.isState() && this.type === PduTypeRoomCanonicalAlias;
	}

	getMembership() {
		return this.getContent<PduMembershipEventContent>().membership;
	}

	getJoinRule() {
		return this.getContent<PduJoinRuleEventContent>().join_rule;
	}

	getUniqueStateIdentifier(): StateMapKey {
		return `${this.type}:${this.stateKey || ''}`;
	}

	get redactedEvent() {
		// it is expected to have everything in this event ready by this point
		const topLevelAllowedKeysExceptContent = [
			'event_id',
			'type',
			'room_id',
			'sender',
			'state_key',
			'hashes', // make sure is not recalculated to be inline wiht synapse
			'signatures', // can change but is not part of reference hash
			'depth', // always 0 for us
			'prev_events', // can change but only in first creation
			'auth_events', // same as ^
			'origin_server_ts',
		];

		const dict = {
			content: {},
		};

		// also freezes the event
		const { event } = this; // fill up to date hash

		for (const key of topLevelAllowedKeysExceptContent) {
			if (key in event) {
				// @ts-ignore TODO:
				dict[key] = event[key];
			}
		}

		const content = this.getContent();

		// m.room.member allows keys membership, join_authorised_via_users_server. Additionally, it allows the signed key of the third_party_invite key.
		if (this.type === PduTypeRoomMember) {
			// @ts-ignore i don't want to fight typescript right now
			dict.content = {
				// @ts-ignore i don't want to fight typescript right now (2)
				membership: content.membership,
			};

			return dict;
		}

		if (this.type === PduTypeRoomCreate) {
			// m.room.create allows all keys.
			dict.content = content;
			return dict;
		}

		if (this.type === PduTypeRoomJoinRules) {
			// m.room.join_rules allows keys join_rule, allow.
			// @ts-ignore i don't want to fight typescript right now (3)
			dict.content = {
				// @ts-ignore i don't want to fight typescript right now (4)
				...(content.join_rule ? { join_rule: content.join_rule } : {}),
				// @ts-ignore i don't want to fight typescript right now (5)
				...(content.allow ? { allow: content.allow } : {}),
			};

			return dict;
		}

		if (this.type === PduTypeRoomPowerLevels) {
			// m.room.power_levels allows keys ban, events, events_default, invite, kick, redact, state_default, users, users_default.
			// @ts-ignore i don't want to fight typescript right now (6)
			dict.content = {
				// @ts-ignore i don't want to fight typescript right now (7)
				ban: content.ban,
				// @ts-ignore i don't want to fight typescript right now (8)
				events: content.events,
				// @ts-ignore i don't want to fight typescript right now (9)
				events_default: content.events_default,
				// @ts-ignore i don't want to fight typescript right now (10)
				invite: content.invite,
				// @ts-ignore i don't want to fight typescript right now (11)
				kick: content.kick,
				// @ts-ignore i don't want to fight typescript right now (12)
				redact: content.redact,
				// @ts-ignore i don't want to fight typescript right now (13)
				state_default: content.state_default,
				// @ts-ignore i don't want to fight typescript right now (14)
				users: content.users,
				// @ts-ignore i don't want to fight typescript right now (15)
				users_default: content.users_default,
			};

			return dict;
		}

		dict.content = content; // not spec compliant, but can't find a way for all events

		return dict;

		// TODO: rest of the event types
	}

	getReferenceHash() {
		// SPEC: https://spec.matrix.org/v1.12/server-server-api/#calculating-the-reference-hash-for-an-event
		// 1. The signatures and unsigned properties are removed from the event, if present.
		const redactedEvent = this.redactedEvent;

		// @ts-ignore TODO:
		const { unsigned, signatures, ...toHash } = redactedEvent;

		// 2. The event is converted into Canonical JSON.
		const canonicalJson = encodeCanonicalJson(toHash);
		// 3. A sha256 hash is calculated on the resulting JSON object.
		const referenceHash = crypto
			.createHash('sha256')
			.update(canonicalJson)
			.digest();

		this.freezeEvent();

		return referenceHash;
	}

	// SPEC: https://spec.matrix.org/v1.12/server-server-api/#calculating-the-content-hash-for-an-event
	getContentHash() {
		// First, any existing unsigned, signature, and hashes members are removed. The resulting object is then encoded as Canonical JSON, and the JSON is hashed using SHA-256.
		const { unsigned, signatures, hashes, ...toHash } = this.rawEvent; // must not use this.event as it can potentially call getContentHash again

		return crypto
			.createHash('sha256')
			.update(encodeCanonicalJson(toHash))
			.digest();
	}

	getContentHashString() {
		return toUnpaddedBase64(this.getContentHash());
	}

	// https://spec.matrix.org/v1.12/server-server-api/#auth-events-selection
	getAuthEventStateKeys(): StateMapKey[] {
		if (this.isCreateEvent()) {
			// The auth_events for the m.room.create event in a room is empty;
			return [];
		}

		// for all others
		const authTypes = [
			// The current m.room.power_levels event, if any.
			getStateMapKey({ type: PduTypeRoomPowerLevels }),

			// The sender's current m.room.member event, if any.
			getStateMapKey({ type: PduTypeRoomMember, state_key: this.sender }),

			// The m.room.create event.
			getStateMapKey({ type: PduTypeRoomCreate }),
		];

		// If type is m.room.member:

		if (this.isMembershipEvent()) {
			//The target's current m.room.member event, if any.
			authTypes.push(
				getStateMapKey({ type: PduTypeRoomMember, state_key: this.stateKey }),
			);

			// If membership is join or invite, the current m.room.join_rules event, if any.
			const membership = this.getMembership();
			if (membership === 'join' || membership === 'invite') {
				authTypes.push(getStateMapKey({ type: PduTypeRoomJoinRules }));
			}

			// If membership is invite and content contains a third_party_invite property, the current m.room.third_party_invite event with state_key matching content.third_party_invite.signed.token, if any.
			if (
				membership === 'invite' &&
				this.getContent<PduMembershipEventContent>().third_party_invite
			) {
				throw new Error('third_party_invite not supported');
			}

			// If content.join_authorised_via_users_server is present, and the room version supports restricted rooms, then the m.room.member event with state_key matching content.join_authorised_via_users_server.
			if (
				this.getContent<PduMembershipEventContent>()
					.join_authorised_via_users_server
			) {
				throw new Error('join_authorised_via_users_server not supported');
			}
		}

		return authTypes;
	}

	get rejected() {
		return this._rejectedReason !== undefined;
	}

	reject(reason: string) {
		this._rejectedReason = reason;
	}

	get rejectedReason() {
		return this._rejectedReason;
	}

	addPreviousEvent(event: PersistentEventBase) {
		this.rawEvent.prev_events.push(event.eventId);
		return this;
	}

	authedBy(event: PersistentEventBase) {
		this.rawEvent.auth_events.push(event.eventId);
		return this;
	}
}
export type { EventStore };
