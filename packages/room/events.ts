export enum PDUType {
	// Copied from: https://github.com/element-hq/synapse/blob/2277df2a1eb685f85040ef98fa21d41aa4cdd389/synapse/api/constants.py#L103-L141
	Member = "m.room.member",
	Create = "m.room.create",
	Tombstone = "m.room.tombstone",
	JoinRules = "m.room.join_rules",
	PowerLevels = "m.room.power_levels",
	Aliases = "m.room.aliases",
	Redaction = "m.room.redaction",
	ThirdPartyInvite = "m.room.third_party_invite",
	RoomHistoryVisibility = "m.room.history_visibility",
	CanonicalAlias = "m.room.canonical_alias",
	Encrypted = "m.room.encrypted",
	RoomAvatar = "m.room.avatar",
	RoomEncryption = "m.room.encryption",
	GuestAccess = "m.room.guest_access",
	Message = "m.room.message",
	Topic = "m.room.topic",
	Name = "m.room.name",
	ServerACL = "m.room.server_acl",
	Pinned = "m.room.pinned_events",
	Retention = "m.room.retention",
	Dummy = "org.matrix.dummy_event",
	SpaceChild = "m.space.child",
	SpaceParent = "m.space.parent",
	Reaction = "m.reaction",
	Sticker = "m.sticker",
	LiveLocationShareStart = "m.beacon_info",
	CallInvite = "m.call.invite",
	PollStart = "m.poll.start",
}

export enum EDUType {
	// Copied from: https://github.com/element-hq/synapse/blob/2277df2a1eb685f85040ef98fa21d41aa4cdd389/synapse/api/constants.py#L156-L163
	Presence = "m.presence",
	Typing = "m.typing",
	Receipt = "m.receipt",
	DeviceListUpdate = "m.device_list_update",
	SigningKeyUpdate = "m.signing",
	UnstableSigningKeyUpdate = "org.matrix.signing_key_update",
	DirectToDevice = "m.direct_to_device",
}

export type PDUTypeString = `${PDUType}`;
export type EDUTypeString = `${EDUType}`;
export type EventTypeString = PDUTypeString | EDUTypeString;

export type EventTypString = PDUTypeString | EDUTypeString;

export interface EventHash {
	sha256: string;
}

// get it from https://spec.matrix.org/v1.12/rooms/v1/#event-format
export interface V1Pdu {
	auth_events: (string | EventHash)[];
	content: object;
	depth: number;
	event_id: string;
	hashes: EventHash;
	origin_server_ts: number;
	prev_events: (string | EventHash)[];
	redacts?: string;
	room_id: string;
	sender: string;
	signatures: { [key: string]: { [key: string]: string } };
	state_key?: string;
	type: EventTypeString;
	unsigned?: {
		[key: string]: unknown;
	};
}

export interface V2Pdu extends V1Pdu {
	auth_events: string[];
	prev_events: string[];
}

export type PDUMembershipType = "join" | "leave" | "invite" | "ban" | "knock";

export type PDUMembershipEvent = V2Pdu & {
	content: {
		avatar_url?: string;
		displayname?: string;
		is_direct: boolean;
		join_authorised_via_users_server: string;
		membership: PDUMembershipType;
		reason?: string;
		// TODO
		third_party_invite?: any;
	};
};

export function isMembershipEvent(event: V2Pdu): event is PDUMembershipEvent {
	return event.type === PDUType.Member;
}

export type PDUCreateEvent = V2Pdu & {
	state_key: "";
	content: {
		// only present in, room versions 1 - 10. Starting with room version 11 the event sender should be used instead.
		creator: string;
		"m.federate"?: boolean;
		predecessor?: {
			event_id: string;
			room_id: string;
		};
		room_version?: string; // defaults to 1
		type: string;
	};
};

export function isCreateEvent(event: V2Pdu): event is PDUCreateEvent {
	return event.type === PDUType.Create && event.state_key === "";
}

export type PDUJoinRuleEvent = V2Pdu & {
	state_key: "";
	content: {
		join_rule:
			| "public"
			| "invite"
			| "knock"
			| "private"
			| "public"
			| "restricted"
			| "knock_restricted";
		allow: {
			room_id: string;
			type: string;
		};
	};
};

export function isJoinRuleEvent(event: V2Pdu): event is PDUJoinRuleEvent {
	return (
		event.type === PDUType.JoinRules &&
		event.state_key === "" &&
		"join_rule" in event.content
	);
}

export type PDUPowerLevelsEvent = V2Pdu & {
	state_key: "";
	content: {
		// The level required to ban a user.
		ban: number; // defaults to 50 if not specified
		// The level required to send specific event types. This is a mapping from event type to power level required.
		events: Record<string, number>;
		//  The default level required to send message events. Can be overridden by the events key.
		events_default: number; // defaults to 0
		//  The level required to invite a user. Defaults to 0 if unspecified.
		invite: number;
		//  The level required to kick a user. Defaults to 50 if unspecified.
		kick: number;
		//  The power level requirements for specific notification types. This is a mapping from key to power level for that notifications key.
		notifications: {
			//  The level required to trigger an @room notification. Defaults to 50 if unspecified.
			room: number;
			// others as said in spec
			[k: string]: number;
		};
		//  The level required to redact an event sent by another user. Defaults to 50 if unspecified.
		redact: number;
		//  The default level required to send state events. Can be overridden by the events key. Defaults to 50 if unspecified.
		state_default: number;
		//  The power levels for specific users. This is a mapping from user_id to power level for that user.
		users: Record<string, number>;
		// The power level for users in the room whose user_id is not mentioned in the users key. Defaults to 0 if unspecified.
		// NOTE: When there is no m.room.power_levels event in the room, the room creator has a power level of 100, and all other users have a power level of 0.
		users_default: number;
	};
};

export function isPowerEvent(event: V2Pdu): event is PDUPowerLevelsEvent {
	return event.type === PDUType.PowerLevels && event.state_key === "";
}

// if unspecified just sets the default number
export function getPowerLevel(
	event?: PDUPowerLevelsEvent,
): PDUPowerLevelsEvent | undefined {
	return (
		event && {
			...event,
			...{
				content: {
					...event.content,
					ban: event.content.ban ?? 50,
					invite: event.content.invite ?? 0,
					kick: event.content.kick ?? 50,
					redact: event.content.redact ?? 50,
					state_default: event.content.state_default ?? 50,
					events_default: event.content.events_default ?? 0,
					users_default: event.content.users_default ?? 0,
				},
			},
		}
	);
}

export type EventID = string;
export type StateKey = string;
export type EventType = string;
export type StateMapKey = `${EventType}:${StateKey}`;
export type State = Map<StateMapKey, EventID>;
