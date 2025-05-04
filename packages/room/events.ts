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

export type EventHash = {
  sha256: string;
};

// get it from https://spec.matrix.org/v1.12/rooms/v1/#event-format
export type V1Pdu = {
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
};

export type V2Pdu = Omit<V1Pdu, "auth_events" | "prev_events"> & {
  auth_events: string[];
  prev_events: string[];
};

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
    //   third_party_invite?: any
  };
};

export type EventID = string;
export type StateKey = string;
export type EventType = string;
export type StateMapKey = `${EventType}:${StateKey}`;
export type State = Map<StateMapKey, EventID>;
