import { encodeCanonicalJson } from "@hs/homeserver/src/signJson";
import type { StateMapKey } from "../types/_common";
import {
	type PduPowerLevelsEventContent,
	PduTypeRoomCanonicalAlias,
	PduTypeRoomCreate,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomMessage,
	PduTypeRoomPowerLevels,
	type PduV1,
	type PduMembershipEventContent,
	type PduJoinRuleEventContent,
	type PduType,
	isMembershipEvent,
} from "../types/v1";
import type { PduPowerLevelsEventV3Content, PduV3 } from "../types/v3";
import { toUnpaddedBase64 } from "@hs/homeserver/src/binaryData";
import crypto from "node:crypto";
import { type PduPowerLevelsEventV10Content, type PduV10 } from "../types/v10";
import {
	getStateMapKey,
	type EventStore,
} from "../state_resolution/definitions/definitions";

function extractDomain(identifier: string) {
	return identifier.split(":").pop();
}

type RoomVersion1And2 = 1 | 2;

type RoomVersion3To9 = 3 | 4 | 5 | 6 | 7 | 8 | 9;

type RoomVersion10And11 = 10 | 11;

type RoomVersion = RoomVersion1And2 | RoomVersion3To9 | RoomVersion10And11;

type PduVersionForRoomVersion<T extends RoomVersion> =
	T extends RoomVersion1And2
		? PduV1
		: T extends RoomVersion3To9
			? PduV3
			: T extends RoomVersion10And11
				? PduV10
				: never;

// convinient wrapper to manage schema differences when working with same algorithms across different versions
export abstract class PersistentEventBase<T extends RoomVersion = RoomVersion> {
	// private _hash!: string;
	private _rejected = false;
	constructor(protected readonly rawEvent: PduVersionForRoomVersion<T>) {
		// this._hash = toUnpaddedBase64(this.getContentHash());
	}

	get sha256hash() {
		return (
			this.rawEvent.hashes?.sha256 ?? toUnpaddedBase64(this.getContentHash())
		);
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

	abstract get eventId(): string;

	getContent<T extends (PduV1 | PduV3 | PduV10)["content"]>(): T {
		return this.rawEvent.content as T;
	}

	// room version dependent
	abstract getAuthorizationEvents(
		store: EventStore,
	): Promise<PersistentEventBase[]>;

	abstract getPreviousEvents(store: EventStore): Promise<PersistentEventBase[]>;

	abstract transformPowerLevelEventData(data: string | number): number;

	// power level event accessors
	getRequiredPowerForInvite() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.invite
			? this.transformPowerLevelEventData(content.invite)
			: 0;
	}

	getRequiredPowerForKick() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.kick ? this.transformPowerLevelEventData(content.kick) : 50;
	}

	getRequiredPowerForBan() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.ban ? this.transformPowerLevelEventData(content.ban) : 50;
	}

	getRequiredPowerForRedact() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.redact
			? this.transformPowerLevelEventData(content.redact)
			: 50;
	}

	getPowerLevelForUser(userId: string, createEvent?: PersistentEventBase) {
		const content = this.getContent<PduPowerLevelsEventContent>();
		if (content.users?.[userId]) {
			return this.transformPowerLevelEventData(content.users[userId]);
		}

		if (content.users_default) {
			return this.transformPowerLevelEventData(content.users_default);
		}

		return createEvent?.sender === userId ? 100 : 0;
	}

	getRequiredPowerLevelForEvent(type: PduType) {
		const content = this.getContent<PduPowerLevelsEventContent>();

		if (content.events?.[type]) {
			return this.transformPowerLevelEventData(content.events[type]);
		}

		if (type === PduTypeRoomMessage) {
			return content.events_default
				? this.transformPowerLevelEventData(content.events_default)
				: 0;
		}

		// state events
		return content.state_default
			? this.transformPowerLevelEventData(content.state_default)
			: 50;
	}

	// raw transformed values
	//
	getPowerLevelBanValue() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.ban
			? this.transformPowerLevelEventData(content.ban)
			: undefined;
	}

	getPowerLevelKickValue() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.kick
			? this.transformPowerLevelEventData(content.kick)
			: undefined;
	}

	getPowerLevelInviteValue() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.invite
			? this.transformPowerLevelEventData(content.invite)
			: undefined;
	}

	getPowerLevelRedactValue() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.redact
			? this.transformPowerLevelEventData(content.redact)
			: undefined;
	}

	getPowerLevelEventsDefaultValue() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.events_default
			? this.transformPowerLevelEventData(content.events_default)
			: undefined;
	}

	getPowerLevelStateDefaultValue() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.state_default
			? this.transformPowerLevelEventData(content.state_default)
			: undefined;
	}

	// users_default
	getPowerLevelUserDefaultValue() {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.users_default
			? this.transformPowerLevelEventData(content.users_default)
			: undefined;
	}

	getPowerLevelEventsValue(type: PduType) {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.events?.[type]
			? this.transformPowerLevelEventData(content.events[type])
			: undefined;
	}

	getPowerLevelUsersValue(userId: string) {
		const content = this.getContent<PduPowerLevelsEventContent>();
		return content.users?.[userId]
			? this.transformPowerLevelEventData(content.users[userId])
			: undefined;
	}

	isState() {
		// spec wise this is the right way to check if an event is a state event
		return this.rawEvent.state_key !== undefined;
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
		return `${this.type}:${this.stateKey || ""}`;
	}

	getReferenceHash() {
		// SPEC: https://spec.matrix.org/v1.12/server-server-api/#calculating-the-reference-hash-for-an-event
		// 1. The signatures and unsigned properties are removed from the event, if present.
		const { unsigned, signatures, ...toHash } = this.rawEvent;

		// 2. The event is converted into Canonical JSON.
		const canonicalJson = encodeCanonicalJson(toHash);
		// 3. A sha256 hash is calculated on the resulting JSON object.
		const referenceHash = crypto
			.createHash("sha256")
			.update(canonicalJson)
			.digest();

		return referenceHash;
	}

	// SPEC: https://spec.matrix.org/v1.12/server-server-api/#calculating-the-content-hash-for-an-event
	getContentHash() {
		// First, any existing unsigned, signature, and hashes members are removed. The resulting object is then encoded as Canonical JSON, and the JSON is hashed using SHA-256.
		const { unsigned, signatures, hashes, ...toHash } = this.rawEvent;

		return crypto
			.createHash("sha256")
			.update(encodeCanonicalJson(toHash))
			.digest();
	}

	getAuthEventStateKeys(): StateMapKey[] {
		if (this.isCreateEvent()) {
			return [];
		}

		const authTypes = [
			getStateMapKey({ type: PduTypeRoomPowerLevels }),
			getStateMapKey({ type: PduTypeRoomMember, state_key: this.stateKey }),
			getStateMapKey({ type: PduTypeRoomCreate }),
		];

		if (
			this.isMembershipEvent() &&
			["join", "knock", "invite"].includes(this.getMembership())
		) {
			authTypes.push(getStateMapKey({ type: PduTypeRoomJoinRules }));
		}

		return authTypes;
	}

	get rejected() {
		return this._rejected;
	}

	set rejected(value: boolean) {
		this._rejected = value;
	}
}

export class PersistentEventV1 extends PersistentEventBase<1 | 2> {
	async getAuthorizationEvents(
		store: EventStore,
	): Promise<PersistentEventBase[]> {
		const authEventIds: string[] = [];
		const authEventHashes: string[] = [];

		for (const id of this.rawEvent.auth_events) {
			if (typeof id === "string") {
				authEventIds.push(id);
			} else {
				authEventHashes.push(id.sha256);
			}
		}

		return Promise.all([
			await store.getEvents(authEventIds),
			await store.getEventsByHashes(authEventHashes),
		]).then(([eventsById, eventsByHash]) => eventsById.concat(eventsByHash));
	}

	async getPreviousEvents(store: EventStore): Promise<PersistentEventBase[]> {
		const prevEventIds: string[] = [];
		const prevEventHashes: string[] = [];

		for (const id of this.rawEvent.prev_events) {
			if (typeof id === "string") {
				prevEventIds.push(id);
			} else {
				prevEventHashes.push(id.sha256);
			}
		}

		return Promise.all([
			await store.getEvents(prevEventIds),
			await store.getEventsByHashes(prevEventHashes),
		]).then(([eventsById, eventsByHash]) => eventsById.concat(eventsByHash));
	}

	// SPEC: https://spec.matrix.org/v1.12/rooms/v1/#event-ids
	// $opaque_id:domain
	// where domain is the server name of the homeserver which created the room, and opaque_id is a locally-unique string.
	get eventId(): string {
		return this.rawEvent.event_id;
	}

	// v1 has all as strings
	transformPowerLevelEventData(data: string): number {
		return Number.parseInt(data, 10);
	}
}

// v3 is where it changes first
class PersistentEventV3Base<
	T extends RoomVersion3To9 | RoomVersion10And11,
> extends PersistentEventBase<T> {
	private _eventId!: string;
	constructor(rawEvent: PduVersionForRoomVersion<T>) {
		super(rawEvent);

		// SPEC: https://spec.matrix.org/v1.12/rooms/v3/#event-ids
		const referenceHash = this.getReferenceHash();

		// The event ID is the reference hash of the event encoded using Unpadded Base64, prefixed with $. A resulting event ID using this approach should look similar to $CD66HAED5npg6074c6pDtLKalHjVfYb2q4Q3LZgrW6o.
		this._eventId = `\$${toUnpaddedBase64(referenceHash)}`;
	}

	async getAuthorizationEvents(
		store: EventStore,
	): Promise<PersistentEventBase[]> {
		return store.getEvents(this.rawEvent.auth_events);
	}

	async getPreviousEvents(store: EventStore): Promise<PersistentEventBase[]> {
		return store.getEvents(this.rawEvent.prev_events);
	}
	get eventId(): string {
		return this._eventId;
	}

	// v3 needs backwards compatibility with v1
	transformPowerLevelEventData(data: number | string): number {
		return typeof data === "number" ? data : Number.parseInt(data, 10);
	}
}

export class PersistentEventV3 extends PersistentEventV3Base<RoomVersion3To9> {}

export class PersistentEventV10 extends PersistentEventV3Base<RoomVersion10And11> {
	// all are numbers
	transformPowerLevelEventData(data: number): number {
		return data;
	}
}

function isV1ToV2(_event: unknown, roomVersion: RoomVersion): _event is PduV1 {
	return roomVersion === 1 || roomVersion === 2;
}

function isV3To9(_event: unknown, roomVersion: RoomVersion): _event is PduV3 {
	return (
		roomVersion === 3 ||
		roomVersion === 4 ||
		roomVersion === 5 ||
		roomVersion === 6 ||
		roomVersion === 7 ||
		roomVersion === 8 ||
		roomVersion === 9
	);
}

function isV10To11(
	_event: unknown,
	roomVersion: RoomVersion,
): _event is PduV10 {
	return roomVersion === 10 || roomVersion === 11;
}

export class PersistentEventFactory {
	static create(
		event: PduV1 | PduV3 | PduV10,
		roomVersion: RoomVersion,
	): PersistentEventBase<RoomVersion> {
		if (isV1ToV2(event, roomVersion)) {
			return new PersistentEventV1(event);
		}

		if (isV3To9(event, roomVersion)) {
			return new PersistentEventV3(event);
		}

		if (isV10To11(event, roomVersion)) {
			return new PersistentEventV10(event);
		}

		throw new Error(`Unknown room version: ${roomVersion}`);
	}
}
