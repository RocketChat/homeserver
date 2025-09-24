import crypto from 'node:crypto';
import {
	encodeCanonicalJson,
	toUnpaddedBase64,
} from '@rocket.chat/federation-crypto';
import {
	type EventStore,
	getStateMapKey,
} from '../state_resolution/definitions/definitions';
import type { EventID, PduForType, StateMapKey } from '../types/_common';
import {
	Pdu,
	PduContent,
	type PduJoinRuleEventContent,
	type PduMembershipEventContent,
	PduType,
	Signature,
} from '../types/v3-11';
import { PowerLevelEvent } from './power-level-event-wrapper';
import { type RoomVersion } from './type';

function extractDomain(identifier: string) {
	return identifier.split(':').pop();
}

type MakeOptional<T, K extends keyof T> = {
	[KK in K]?: T[KK];
} & {
	[KK in keyof T as KK extends K ? never : KK]: T[KK];
};

export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

export type PduWithHashesAndSignaturesOptional<T extends Pdu = Pdu> = Prettify<
	MakeOptional<T, 'hashes' | 'signatures'>
>;

export const REDACT_ALLOW_ALL_KEYS: unique symbol = Symbol.for('all');

// convinient wrapper to manage schema differences when working with same algorithms across different versions
export abstract class PersistentEventBase<
	T extends RoomVersion = '11',
	Type extends PduType = PduType,
> {
	private _rejectedReason?: string;

	private signatures: Signature = {};

	protected rawEvent: PduWithHashesAndSignaturesOptional;

	constructor(event: PduWithHashesAndSignaturesOptional) {
		this.rawEvent = JSON.parse(JSON.stringify(event));
		if (this.rawEvent.signatures) {
			this.signatures = this.rawEvent.signatures;
		}
	}

	// don't recalculate the hash if it is already set
	get sha256hash() {
		if (!this.rawEvent.hashes) {
			this.rawEvent.hashes = {
				sha256: toUnpaddedBase64(this.getContentHash()),
			};
		}

		return this.rawEvent.hashes.sha256;
	}

	get type(): Type {
		return this.rawEvent.type as Type;
	}

	get roomId() {
		return this.rawEvent.room_id;
	}

	get sender() {
		return this.rawEvent.sender;
	}

	// TODO: This should be removed or different name used instead?

	get origin() {
		const domain = extractDomain(this.rawEvent.sender);
		if (!domain) {
			throw new Error('Invalid sender, no domain found');
		}
		return domain;
	}

	get stateKey(): string | undefined {
		return 'state_key' in this.rawEvent
			? (this.rawEvent.state_key as string)
			: undefined;
	}

	get originServerTs() {
		return this.rawEvent.origin_server_ts;
	}

	// if we are accessing the inner event, the event itself should be frozen immediately to not change the reference hash any longer, affecting the id
	// if anywhere the code still tries to, we will throw an error, which is why "lock" isn't just a flag in the class.
	get event(): Readonly<PduForType<Type>> {
		return {
			...this.getEventWithoutHashes(),
			hashes: {
				sha256: toUnpaddedBase64(this.getContentHash()),
			},
			signatures: this.signatures,
			unsigned: this.rawEvent.unsigned ?? {},
		} as PduForType<Type>;
	}

	private getEventWithoutHashes() {
		const { hashes, signatures, ...event } = this.rawEvent;
		return {
			...event,
			auth_events: Array.from(new Set([...this.rawEvent.auth_events])),
			prev_events: Array.from(new Set([...this.rawEvent.prev_events])),
		};
	}

	get depth() {
		return this.rawEvent.depth;
	}

	// v1 should have this already, others, generates it
	abstract get eventId(): EventID;

	getContent<T extends PduContent<Type>>(): T {
		return this.rawEvent.content as T;
	}

	toPowerLevelEvent() {
		if (this.isPowerLevelEvent()) {
			return PowerLevelEvent.fromEvent(this);
		}

		throw new Error('Event is not a power level event');
	}

	// room version dependent
	abstract getAuthorizationEvents(
		store: EventStore,
	): Promise<PersistentEventBase<T>[]>;

	abstract getPreviousEvents(
		store: EventStore,
	): Promise<PersistentEventBase<T>[]>;

	isState() {
		// spec wise this is the right way to check if an event is a state event
		return (
			'state_key' in this.rawEvent &&
			typeof this.rawEvent.state_key === 'string'
		);
	}

	isTimelineEvent() {
		return !this.isState();
	}

	isTopicEvent(): this is PersistentEventBase<T, 'm.room.topic'> {
		return this.isState() && this.type === 'm.room.topic';
	}

	isPowerLevelEvent(): this is PersistentEventBase<T, 'm.room.power_levels'> {
		return this.isState() && this.type === 'm.room.power_levels';
	}

	isNameEvent(): this is PersistentEventBase<T, 'm.room.name'> {
		return this.isState() && this.type === 'm.room.name';
	}

	isJoinRuleEvent(): this is PersistentEventBase<T, 'm.room.join_rules'> {
		return this.isState() && this.type === 'm.room.join_rules';
	}

	isMembershipEvent(): this is PersistentEventBase<T, 'm.room.member'> {
		return this.isState() && this.type === 'm.room.member';
	}

	isCreateEvent(): this is PersistentEventBase<T, 'm.room.create'> {
		return this.isState() && this.type === 'm.room.create';
	}

	isServerAclEvent(): this is PersistentEventBase<T, 'm.room.server_acl'> {
		return this.isState() && this.type === 'm.room.server_acl';
	}

	isHistoryVisibilityEvent(): this is PersistentEventBase<
		T,
		'm.room.history_visibility'
	> {
		return this.isState() && this.type === 'm.room.history_visibility';
	}

	isCanonicalAliasEvent(): this is PersistentEventBase<
		T,
		'm.room.canonical_alias'
	> {
		return this.isState() && this.type === 'm.room.canonical_alias';
	}

	isAliasEvent(): this is PersistentEventBase<T, 'm.room.aliases'> {
		return this.isState() && this.type === 'm.room.aliases';
	}

	getMembership() {
		if (!this.isMembershipEvent())
			throw new Error('Event is not a membership event');

		return (this.getContent() as PduMembershipEventContent).membership;
	}

	getJoinRule() {
		if (!this.isJoinRuleEvent()) {
			throw new Error('Event is not a join rule event');
		}

		return (this.getContent() as PduJoinRuleEventContent).join_rule;
	}

	getUniqueStateIdentifier(): StateMapKey {
		return `${this.type}:${this.stateKey || ''}`;
	}

	// for redaction algorithm
	abstract getAllowedKeys(): string[];

	abstract getAllowedContentKeys(): Record<
		PduType,
		string[] | typeof REDACT_ALLOW_ALL_KEYS
	>;

	private _getRedactedEvent(event: PduWithHashesAndSignaturesOptional) {
		type KeysExceptContent = Exclude<keyof Pdu, 'content'>;

		// it is expected to have everything in this event ready by this point
		const topLevelAllowedKeysExceptContent =
			this.getAllowedKeys() as KeysExceptContent[];

		const dict = {} as Record<KeysExceptContent, Pdu[KeysExceptContent]>;

		for (const key of topLevelAllowedKeysExceptContent) {
			if (key in event) {
				dict[key] = event[key];
			}
		}

		const currentContent = this.getContent();

		let newContent = {} as Partial<PduContent>;

		// m.room.member allows keys membership, join_authorised_via_users_server. Additionally, it allows the signed key of the third_party_invite key.
		const allowedContentKeys = this.getAllowedContentKeys()[this.type] as
			| (keyof PduContent)[]
			| typeof REDACT_ALLOW_ALL_KEYS;

		if (allowedContentKeys) {
			if (allowedContentKeys === REDACT_ALLOW_ALL_KEYS) {
				newContent = currentContent;
			} else {
				for (const key of allowedContentKeys) {
					if (key in currentContent) {
						newContent[key] = currentContent[key];
					}
				}
			}
		}

		dict.unsigned = {};

		// this is not in spec
		if (event.unsigned) {
			if ('age_ts' in event.unsigned) {
				dict.unsigned.age_ts = event.unsigned.age_ts;
			}
			if ('replaces_state' in event.unsigned) {
				dict.unsigned.replaces_state = event.unsigned.replaces_state;
			}
		}

		// tests expect this to be present
		if (!dict.signatures) {
			dict.signatures = this.signatures ?? {};
		}

		return {
			...dict,
			content: newContent,
		};
	}

	// for tests
	get redactedRawEvent() {
		return this._getRedactedEvent(this.rawEvent);
	}

	get redactedEvent() {
		return this._getRedactedEvent(this.event); // content hash generated if not present already
	}

	getReferenceHash() {
		// SPEC: https://spec.matrix.org/v1.12/server-server-api/#calculating-the-reference-hash-for-an-event
		// 1. The signatures and unsigned properties are removed from the event, if present.
		const redactedEvent = this.redactedEvent;

		const { unsigned, signatures, ...toHash } = redactedEvent;

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
	static getContentHash(rawEvent: PduWithHashesAndSignaturesOptional) {
		// First, any existing unsigned, signature, and hashes members are removed. The resulting object is then encoded as Canonical JSON, and the JSON is hashed using SHA-256.
		const { unsigned, signatures, hashes, ...toHash } = rawEvent; // must not use this.event as it can potentially call getContentHash again

		return crypto
			.createHash('sha256')
			.update(encodeCanonicalJson(toHash))
			.digest();
	}

	static getContentHashString(rawEvent: PduWithHashesAndSignaturesOptional) {
		return toUnpaddedBase64(PersistentEventBase.getContentHash(rawEvent));
	}

	getContentHash() {
		return PersistentEventBase.getContentHash({
			...this.rawEvent,
			...this.getEventWithoutHashes(), // basically make sure the prev and auth events are not duplicated
		});
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
		const authTypes = new Set<StateMapKey>([
			// The current m.room.power_levels event, if any.
			getStateMapKey({ type: 'm.room.power_levels' }),

			// The sender's current m.room.member event, if any.
			getStateMapKey({ type: 'm.room.member', state_key: this.sender }),

			// The m.room.create event.
			getStateMapKey({ type: 'm.room.create' }),
		]);

		// If type is m.room.member:

		if (this.isMembershipEvent()) {
			//The target’s current m.room.member event, if any.
			authTypes.add(
				getStateMapKey({ type: 'm.room.member', state_key: this.stateKey }),
			);

			// If membership is join or invite, the current m.room.join_rules event, if any.
			const membership = this.getMembership();
			if (membership === 'join' || membership === 'invite') {
				authTypes.add(getStateMapKey({ type: 'm.room.join_rules' }));
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

		return Array.from(authTypes);
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

	addPrevEvents(events: PersistentEventBase<T>[]) {
		this.rawEvent.prev_events.push(...events.map((e) => e.eventId));
		if (this.rawEvent.depth <= events[events.length - 1].depth) {
			this.rawEvent.depth = events[events.length - 1].depth + 1;
		}
		return this;
	}

	authedBy(event: PersistentEventBase<T>) {
		this.rawEvent.auth_events.push(event.eventId);
		return this;
	}

	addSignature(origin: string, keyId: string, signature: string) {
		this.signatures[origin] = {
			[keyId]: signature,
		};

		return this;
	}
}
export type { EventStore };
