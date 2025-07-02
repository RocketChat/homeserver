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
	) {
		if (!rawEvent.hashes) {
			rawEvent.hashes = {
				sha256: toUnpaddedBase64(this.getContentHash()),
			};
		}
	}

	get sha256hash() {
		// should be set already in the constructor
		// constructor has the typing to allow partial event passing
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
		return this.rawEvent;
	}

	get depth() {
		return this.rawEvent.depth;
	}

	sign(serverName: string) {
		if (this.rawEvent.signatures?.[serverName]) {
			return;
		}

		// TODO:
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

	getReferenceHash() {
		// SPEC: https://spec.matrix.org/v1.12/server-server-api/#calculating-the-reference-hash-for-an-event
		// 1. The signatures and unsigned properties are removed from the event, if present.
		const { unsigned, signatures, ...toHash } = this.rawEvent;

		// 2. The event is converted into Canonical JSON.
		const canonicalJson = encodeCanonicalJson(toHash);
		// 3. A sha256 hash is calculated on the resulting JSON object.
		const referenceHash = crypto
			.createHash('sha256')
			.update(canonicalJson)
			.digest();

		return referenceHash;
	}

	// SPEC: https://spec.matrix.org/v1.12/server-server-api/#calculating-the-content-hash-for-an-event
	getContentHash() {
		// First, any existing unsigned, signature, and hashes members are removed. The resulting object is then encoded as Canonical JSON, and the JSON is hashed using SHA-256.
		const { unsigned, signatures, hashes, ...toHash } = this.rawEvent;

		return crypto
			.createHash('sha256')
			.update(encodeCanonicalJson(toHash))
			.digest();
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
