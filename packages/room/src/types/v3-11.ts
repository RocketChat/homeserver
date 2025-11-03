import { z } from 'zod';
import {
	PduForType,
	eventIdSchema,
	roomIdSchema,
	userIdSchema,
} from './_common';

// Copied from: https://github.com/element-hq/synapse/blob/2277df2a1eb685f85040ef98fa21d41aa4cdd389/synapse/api/constants.py#L103-L141

export const PduTypeSchema = z.enum([
	'm.room.member',
	'm.room.create',
	'm.room.tombstone',
	'm.room.join_rules',
	'm.room.power_levels',
	'm.room.aliases',
	'm.room.redaction',
	'm.room.third_party_invite',
	'm.room.history_visibility',
	'm.room.canonical_alias',
	'm.room.encrypted',
	'm.room.avatar',
	'm.room.encryption',
	'm.room.guest_access',
	'm.room.message',
	'm.room.topic',
	'm.room.name',
	'm.room.server_acl',
	'm.room.pinned_events',
	'm.room.retention',
	'org.matrix.dummy_event',
	'm.space.child',
	'm.space.parent',
	'm.reaction',
	'm.sticker',
	'm.beacon_info',
	'm.call.invite',
]);

export const EduTypeSchema = z.enum([
	'm.presence',
	'm.typing',
	'm.receipt',
	'm.device_list_update',
	'm.signing',
	'org.matrix.signing_key_update',
	'm.direct_to_device',
]);

export type PduType = z.infer<typeof PduTypeSchema>;
export type EduType = z.infer<typeof EduTypeSchema>;
export const EventTypeSchema = z.union([PduTypeSchema, EduTypeSchema]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventHashSchema = z.object({
	sha256: z
		.string()
		.describe('The hash of the event, encoded as a base64 string.'),
});

export type EventHash = z.infer<typeof EventHashSchema>;

export const SignatureSchema = z.record(
	z.string().describe('signing server name'),
	z.record(
		z.string().describe('signing key id'),
		z.string().describe('signature in unpadded base64 format'),
	),
);

export type Signature = z.infer<typeof SignatureSchema>;

// SPEC: https://spec.matrix.org/v1.12/client-server-api/#events
// types all individual event types
// https://spec.matrix.org/v1.12/client-server-api/#room-events
// this is incomplete in spec document, might have to add more types later
//

// https://spec.matrix.org/v1.12/client-server-api/#mroommember

export const PduMembershipTypeSchema = z.enum([
	'join',
	'leave',
	'invite',
	'ban',
	'knock',
]);

export const PduMembershipEventContentSchema = z.object({
	avatar_url: z.string().url().optional(),
	displayname: z.string().optional(),
	is_direct: z
		.boolean()
		.describe(
			'Flag indicating if the room containing this event was created with the intention of being a direct chat',
		)
		.optional(),
	join_authorised_via_users_server: z.string().optional(),
	membership: PduMembershipTypeSchema,
	reason: z.string().optional(),
	third_party_invite: z
		.object({
			display_name: z.string().optional(),
			signed: z.object({
				mxid: z
					.string()
					.describe(
						'The invited matrix user ID. Must be equal to the user_id property of the event.',
					),
				signatures: SignatureSchema.describe('The signatures of the event.'),
				token: z.string(),
			}),
		})
		.optional(),
});

export type PduMembershipEventContent = z.infer<
	typeof PduMembershipEventContentSchema
>;

// https://spec.matrix.org/v1.12/client-server-api/#mroomcreate

export const PduCreateEventContentSchema = z.object({
	creator: z
		.string()
		.describe(
			' The user_id of the room creator. Required for, and only present in, room versions 1 - 10. Starting with room version 11 the event sender should be used instead.',
		),
	'm.federate': z
		.boolean()
		.describe(
			' Whether users on other servers can join this room. Defaults to true if key does not exist.',
		)
		.optional(),
	predecessor: z
		.object({
			event_id: z
				.string()
				.describe('The event ID of the last known event in the old room.'),
			room_id: z.string().describe('The ID of the old room.'),
		})
		.optional(),
	room_version: z
		.enum(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
		.describe(
			" The version of the room. Defaults to '1' if the key does not exist.",
		)
		.optional()
		.default('1'),
	type: z.string().describe('The type of the event.').optional(),
});

export type PduCreateEventContent = z.infer<typeof PduCreateEventContentSchema>;

// https://spec.matrix.org/v1.12/client-server-api/#mroomcreate

export const PduJoinRuleEventContentSchema = z.object({
	join_rule: z
		.enum([
			'public',
			'invite',
			'knock',
			'private',
			'restricted',
			'knock_restricted',
		])
		.describe('The type of rules used for users wishing to join this room.'),
	allow: z
		.array(
			z.object({
				room_id: z
					.string()
					.describe(
						" Required if type is m.room_membership. The room ID to check the user's membership against. If the user is joined to this room, they satisfy the condition and thus are permitted to join the restricted room.",
					),
				type: z
					.enum(['m.room_membership'])
					.describe(
						'The type of condition: m.room_membership - the user satisfies the condition if they are joined to the referenced room. One of: [m.room_membership]',
					),
			}),
		)
		.describe(
			'For restricted rooms, the conditions the user will be tested against. The user needs only to satisfy one of the conditions to join the restricted room. If the user fails to meet any condition, or the condition is unable to be confirmed as satisfied, then the user requires an invite to join the room. Improper or no allow conditions on a restricted join rule imply the room is effectively invite-only (no conditions can be satisfied).',
		)
		.optional(),
});

export type PduJoinRuleEventContent = z.infer<
	typeof PduJoinRuleEventContentSchema
>;

export const PduRoomTopicEventContentSchema = z.object({
	topic: z.string().describe('The topic of the room.'),
});

export type PduRoomTopicEventContent = z.infer<
	typeof PduRoomTopicEventContentSchema
>;

export const PduRoomRedactionContentSchema = z.object({
	reason: z.string().optional(),
});

export type PduRoomRedactionContent = z.infer<
	typeof PduRoomRedactionContentSchema
>;

export const PduHistoryVisibilityEventContentSchema = z.object({
	history_visibility: z
		.enum(['invited', 'joined', 'shared', 'world_readable'])
		.describe('Who can read the room history'),
});

export type PduHistoryVisibilityEventContent = z.infer<
	typeof PduHistoryVisibilityEventContentSchema
>;

export const PduGuestAccessEventContentSchema = z.object({
	guest_access: z
		.enum(['can_join', 'forbidden'])
		.describe('Whether guest users can join the room'),
});

export type PduGuestAccessEventContent = z.infer<
	typeof PduGuestAccessEventContentSchema
>;

// https://spec.matrix.org/v1.12/client-server-api/#mroomserver_acl

export const PduServerAclEventContentSchema = z.object({
	allow: z
		.array(z.string())
		.describe('A list of server names to allow, including wildcards.')
		.optional(),
	deny: z
		.array(z.string())
		.describe('A list of server names to deny, including wildcards.')
		.optional(),
	allow_ip_literals: z
		.boolean()
		.describe('Whether to allow server names that are IP address literals.')
		.optional()
		.default(true),
});

export type PduServerAclEventContent = z.infer<
	typeof PduServerAclEventContentSchema
>;

// https://spec.matrix.org/v1.12/client-server-api/#mroompower_levels

// https://spec.matrix.org/v1.12/rooms/v1/#mroompower_levels-events-accept-values-as-strings
// values are strings

export function getPduPowerLevelsEventContentSchema() {
	// v1 takes strings,
	// v3+ takes numbers or strings, // https://spec.matrix.org/v1.12/rooms/v3/#mroompower_levels-events-accept-values-as-strings

	// v10 takes numbers
	// we convert all to numbers at parse/validation
	const acceptedValueTypes = z.union([
		z.number(),
		z.string().transform((v) => Number.parseInt(v, 10)),
	]);

	return z.object({
		// The level required to ban a user.
		ban: acceptedValueTypes
			.describe('The level required to ban a user.')
			.optional(),
		// The level required to send specific event types. This is a mapping from event type to power level required.
		events: z
			.record(z.string(), acceptedValueTypes)
			.describe(
				'The level required to send specific event types. This is a mapping from event type to power level required.',
			),
		//  The default level required to send message events. Can be overridden by the events key.
		events_default: acceptedValueTypes
			.describe(
				'The default level required to send message events. Can be overridden by the events key.',
			)
			.optional(),
		//  The level required to invite a user. Defaults to 0 if unspecified.
		invite: acceptedValueTypes
			.describe('The level required to invite a user.')
			.optional(),
		//  The level required to kick a user. Defaults to 50 if unspecified.
		kick: acceptedValueTypes
			.describe('The level required to kick a user.')
			.optional(),
		//  The power level requirements for specific notification types. This is a mapping from key to power level for that notifications key.
		notifications: z.union([
			z.object({
				//  The level required to trigger an @room notification. Defaults to 50 if unspecified.
				room: acceptedValueTypes
					.describe('The level required to trigger an @room notification.')
					.optional(),
			}),
			// others as said in spec
			z
				.record(z.string(), acceptedValueTypes)
				.describe('The level required to trigger an @room notification.')
				.optional(),
		]),
		//  The level required to redact an event sent by another user. Defaults to 50 if unspecified.
		redact: acceptedValueTypes
			.describe('The level required to redact an event sent by another user.')
			.optional(),
		//  The default level required to send state events. Can be overridden by the events key. Defaults to 50 if unspecified.
		state_default: acceptedValueTypes
			.describe(
				'The default level required to send state events. Can be overridden by the events key.',
			)
			.optional(),
		//  The power levels for specific users. This is a mapping from user_id to power level for that user.
		users: z
			.record(z.string(), acceptedValueTypes)
			.describe(
				'The power levels for specific users. This is a mapping from user_id to power level for that user.',
			),
		//  The power level for users in the room whose user_id is not mentioned in the users key. Defaults to 0 if unspecified.
		users_default: acceptedValueTypes
			.describe(
				'The power level for users in the room whose user_id is not mentioned in the users key. Defaults to 0 if unspecified.',
			)
			.optional(),

		// historical: z.number(), TODO: check if historical exists in spec - m.power_levels
	});
}

export const PduPowerLevelsEventContentSchema =
	getPduPowerLevelsEventContentSchema();

export type PduPowerLevelsEventContent = z.infer<
	typeof PduPowerLevelsEventContentSchema
>;

// https://spec.matrix.org/v1.12/client-server-api/#mroomcanonical_alias

export const PduCanonicalAliasEventContentSchema = z.object({
	alias: z
		.string()
		.describe(
			' The canonical alias for the room. If not present, null, or empty the room should be considered to have no canonical alias.',
		),
	alt_aliases: z
		.array(z.string())
		.describe(
			' Alternative aliases the room advertises. This list can have aliases despite the alias field being null, empty, or otherwise not present.',
		),
});

export type PduCanonicalAliasEventContent = z.infer<
	typeof PduCanonicalAliasEventContentSchema
>;

export const PduRoomNameEventContentSchema = z.object({
	name: z.string().describe('The name of the room.'),
});

export type PduRoomNameEventContent = z.infer<
	typeof PduRoomNameEventContentSchema
>;

export const PduRoomAvatarEventContentSchema = z.object({
	url: z.string().optional().describe('The URL of the avatar image.'),
	info: z
		.object({
			height: z.number().optional(),
			width: z.number().optional(),
			mimetype: z.string().optional(),
			size: z.number().optional(),
		})
		.optional()
		.describe('Metadata about the avatar image.'),
	thumbnail_url: z.string().optional().describe('The URL of the thumbnail.'),
});

export type PduRoomAvatarEventContent = z.infer<
	typeof PduRoomAvatarEventContentSchema
>;

export const PduRoomPinnedEventsEventContentSchema = z.object({
	pinned: z
		.array(eventIdSchema)
		.optional()
		.describe('An ordered list of event IDs to pin.'),
});

export type PduRoomPinnedEventsEventContent = z.infer<
	typeof PduRoomPinnedEventsEventContentSchema
>;

// Base timeline content schema
const BaseTimelineContentSchema = z.object({
	// Optional fields for message edits and relations aka threads
	'm.relates_to': z
		.object({
			rel_type: z
				.enum(['m.replace', 'm.annotation', 'm.thread'])
				.describe('The type of the relation.')
				.optional(),
			event_id: eventIdSchema
				.describe('The ID of the event that is being related to.')
				.optional(),
			is_falling_back: z
				.boolean()
				.optional()
				.describe('Whether this is a fallback for older clients'),
			'm.in_reply_to': z
				.object({
					event_id: eventIdSchema.describe(
						'The ID of the latest event in the thread for fallback',
					),
				})
				.optional(),
			key: z.string().optional().describe('The key for reactions (emoji).'),
		})
		.optional()
		.describe('Relation information for edits, replies, reactions, etc.'),
});

// Base message content schema
const BaseMessageContentSchema = BaseTimelineContentSchema.extend({
	body: z.string().describe('The body of the message.'),
	msgtype: z
		.enum([
			'm.text',
			'm.image',
			'm.file',
			'm.audio',
			'm.video',
			'm.emote',
			'm.notice',
			'm.location',
		])
		.describe('The type of the message.'),
	// Optional fields for message edits and relations aka threads
	format: z
		.enum(['org.matrix.custom.html'])
		.describe('The format of the message content.')
		.optional(),
	formatted_body: z
		.string()
		.describe('The formatted body of the message.')
		.optional(),
});

// File info schema
const FileInfoSchema = z.object({
	size: z.number().describe('The size of the file in bytes.').optional(),
	mimetype: z.string().describe('The MIME type of the file.').optional(),
	w: z.number().describe('The width of the image/video in pixels.').optional(),
	h: z.number().describe('The height of the image/video in pixels.').optional(),
	duration: z
		.number()
		.describe('The duration of the audio/video in milliseconds.')
		.optional(),
	thumbnail_url: z
		.string()
		.describe('The URL of the thumbnail image.')
		.optional(),
	thumbnail_info: z
		.object({
			w: z
				.number()
				.describe('The width of the thumbnail in pixels.')
				.optional(),
			h: z
				.number()
				.describe('The height of the thumbnail in pixels.')
				.optional(),
			mimetype: z
				.string()
				.describe('The MIME type of the thumbnail.')
				.optional(),
			size: z
				.number()
				.describe('The size of the thumbnail in bytes.')
				.optional(),
		})
		.describe('Information about the thumbnail.')
		.optional(),
});

// Text message content (m.text, m.emote, m.notice)
const TextMessageContentSchema = BaseMessageContentSchema.extend({
	msgtype: z.enum(['m.text', 'm.emote', 'm.notice']),
});

// File message content (m.image, m.file, m.audio, m.video)
const FileMessageContentSchema = BaseMessageContentSchema.extend({
	msgtype: z.enum(['m.image', 'm.file', 'm.audio', 'm.video']),
	url: z.string().describe('The URL of the file.'),
	info: FileInfoSchema.describe('Information about the file.').optional(),
});

// Location message content (m.location)
const LocationMessageContentSchema = BaseMessageContentSchema.extend({
	msgtype: z.literal('m.location'),
	geo_uri: z.string().describe('The geo URI of the location.'),
	// Additional location fields can be added here
});

// New content schema for edits
const NewContentSchema = z.discriminatedUnion('msgtype', [
	TextMessageContentSchema.pick({
		body: true,
		msgtype: true,
		format: true,
		formatted_body: true,
	}),
	FileMessageContentSchema.pick({
		body: true,
		msgtype: true,
		url: true,
		info: true,
	}),
	LocationMessageContentSchema.pick({
		body: true,
		msgtype: true,
		geo_uri: true,
	}),
]);

// Main message content schema using discriminated union
export const PduMessageEventContentSchema = z.union([
	TextMessageContentSchema.extend({
		'm.new_content': NewContentSchema.optional().describe(
			'The new content for message edits.',
		),
	}),
	FileMessageContentSchema.extend({
		'm.new_content': NewContentSchema.optional().describe(
			'The new content for message edits.',
		),
	}),
	LocationMessageContentSchema.extend({
		'm.new_content': NewContentSchema.optional().describe(
			'The new content for message edits.',
		),
	}),
]);

const EncryptedContentSchema = BaseTimelineContentSchema.extend({
	algorithm: z
		.enum(['m.megolm.v1.aes-sha2'])
		.describe('The algorithm used to encrypt the content.'),
	ciphertext: z.string().describe('The encrypted content.'),
	// Optional fields for message edits and relations aka threads
	device_id: z
		.string()
		.describe('The formatted body of the message.')
		.optional(),
	sender_key: z
		.string()
		.describe('The formatted body of the message.')
		.optional(),
	session_id: z
		.string()
		.describe('The formatted body of the message.')
		.optional(),
});

export const PduEncryptionEventContentSchema = z.object({
	algorithm: z
		.enum(['m.megolm.v1.aes-sha2'])
		.describe('The algorithm used to encrypt the content.'),
	ciphertext: z.string().describe('The encrypted content.'),
});

export type PduMessageEventContent = z.infer<
	typeof PduMessageEventContentSchema
>;

export const PduMessageReactionEventContentSchema = z.object({
	'm.relates_to': z.object({
		// TODO: add more types
		rel_type: z.enum(['m.annotation']).describe('The type of the relation.'),
		event_id: z
			.string()
			.describe('The ID of the event that is being annotated.'),
		key: z.string(),
	}),
});

export type PduMessageReactionEventContent = z.infer<
	typeof PduMessageReactionEventContentSchema
>;

// SPEC: https://spec.matrix.org/v1.12/rooms/v1/#event-format
export const PduNoContentTimelineEventSchema = {
	auth_events: z
		.array(eventIdSchema)
		.describe(
			'A list of event IDs that are required in the room state before this event can be applied. The server will not send this event if it is not satisfied.',
		),
	depth: z
		.number()
		.describe(
			'The depth of the event in the DAG. This is a number that is incremented for each event in the DAG.',
		),
	hashes: EventHashSchema.describe(
		'The hashes of the event. This is an object with arbitrary keys and values.',
	),
	origin_server_ts: z
		.number()
		.describe(
			'The timestamp of the event. This is a number that is the number of milliseconds since the Unix epoch.',
		),
	prev_events: z
		.array(eventIdSchema)
		.describe(
			'A list of event IDs that are required in the room state before this event can be applied. The server will not send this event if it is not satisfied.',
		),
	redacts: eventIdSchema
		.describe(
			'The ID of the event that this event redacts. This is an optional field.',
		)
		.optional(),
	room_id: roomIdSchema.describe(
		'The ID of the room that the event is in. This is a unique identifier for the room.',
	),
	sender: userIdSchema.describe(
		'The ID of the user that sent the event. This is a unique identifier for the user.',
	),
	signatures: SignatureSchema.describe(
		'The signatures of the event. This is an object with arbitrary keys and values.',
	),
	unsigned: z
		.any()
		.describe(
			'An object with arbitrary keys and values. This is an optional field.',
		)
		.optional(),
};

export const PduNoContentStateEventSchema = {
	...PduNoContentTimelineEventSchema,
	state_key: userIdSchema.describe(
		'The state key of the event. This is an optional field.',
	),
};

export const PduNoContentEmptyStateKeyStateEventSchema = {
	...PduNoContentTimelineEventSchema,
	state_key: z.literal(''),
};

export const EventPduTypeRoomCreate = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.create'),
	content: PduCreateEventContentSchema,
});

export const EventPduTypeRoomMember = z.object({
	...PduNoContentStateEventSchema,
	type: z.literal('m.room.member'),
	content: PduMembershipEventContentSchema,
});

export const EventPduTypeRoomJoinRules = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.join_rules'),
	content: PduJoinRuleEventContentSchema,
});

export const EventPduTypeRoomPowerLevels = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.power_levels'),
	content: PduPowerLevelsEventContentSchema,
});

export const EventPduTypeRoomCanonicalAlias = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.canonical_alias'),
	content: PduCanonicalAliasEventContentSchema,
});

export const EventPduTypeRoomName = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.name'),
	content: PduRoomNameEventContentSchema,
});

export const EventPduTypeRoomAliases = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.aliases'),
	state_key: z.string().describe("Sender's domain."),
	content: PduCanonicalAliasEventContentSchema,
});

export const EventPduTypeRoomTopic = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.topic'),
	content: PduRoomTopicEventContentSchema,
});

export const EventPduTypeRoomHistoryVisibility = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.history_visibility'),
	content: PduHistoryVisibilityEventContentSchema,
});

export const EventPduTypeRoomGuestAccess = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.guest_access'),
	content: PduGuestAccessEventContentSchema,
});

export const EventPduTypeRoomServerAcl = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.server_acl'),
	content: PduServerAclEventContentSchema,
});

export const PduRoomTombstoneEventContentSchema = z.object({
	body: z.string().describe('The body of the tombstone.'),
	replacement_room: z
		.string()
		.describe('The ID of the replacement room.')
		.optional(),
});

export type PduRoomTombstoneEventContent = z.infer<
	typeof PduRoomTombstoneEventContentSchema
>;

const EventPduTypeRoomTombstone = z.object({
	...PduNoContentTimelineEventSchema,
	type: z.literal('m.room.tombstone'),
	content: PduRoomTombstoneEventContentSchema,
});

const EventPduTypeRoomEncrypted = z.object({
	...PduNoContentTimelineEventSchema,
	type: z.literal('m.room.encrypted'),
	content: EncryptedContentSchema,
});

const EventPduTypeRoomEncryption = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.encryption'),
	content: PduEncryptionEventContentSchema,
});

const EventPduTypeRoomMessage = z.object({
	...PduNoContentTimelineEventSchema,
	type: z.literal('m.room.message'),
	content: PduMessageEventContentSchema,
});

const EventPduTypeRoomReaction = z.object({
	...PduNoContentTimelineEventSchema,
	type: z.literal('m.reaction'),
	content: PduMessageReactionEventContentSchema,
});

const EventPduTypeRoomRedaction = z.object({
	...PduNoContentTimelineEventSchema,
	type: z.literal('m.room.redaction'),
	content: PduRoomRedactionContentSchema,
	redacts: eventIdSchema.describe('event id'),
});

export const EventPduTypeRoomAvatar = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.avatar'),
	content: PduRoomAvatarEventContentSchema,
});

export const EventPduTypeRoomPinnedEvents = z.object({
	...PduNoContentEmptyStateKeyStateEventSchema,
	type: z.literal('m.room.pinned_events'),
	content: PduRoomPinnedEventsEventContentSchema,
});

export const PduStateEventSchema = z.discriminatedUnion('type', [
	EventPduTypeRoomCreate,

	EventPduTypeRoomMember,

	EventPduTypeRoomJoinRules,

	EventPduTypeRoomPowerLevels,

	EventPduTypeRoomCanonicalAlias,

	EventPduTypeRoomName,

	EventPduTypeRoomAliases,

	EventPduTypeRoomTopic,

	EventPduTypeRoomHistoryVisibility,

	EventPduTypeRoomGuestAccess,

	EventPduTypeRoomServerAcl,

	EventPduTypeRoomTombstone,

	EventPduTypeRoomEncryption,

	EventPduTypeRoomAvatar,

	EventPduTypeRoomPinnedEvents,
]);

export const PduTimelineSchema = z.discriminatedUnion('type', [
	EventPduTypeRoomMessage,

	EventPduTypeRoomEncrypted,

	EventPduTypeRoomReaction,

	EventPduTypeRoomRedaction,
]);

export const PduSchema = z.discriminatedUnion('type', [
	...PduTimelineSchema.options,
	...PduStateEventSchema.options,
]);

export type Pdu = z.infer<typeof PduSchema> & {};

export type PduContent<T extends PduType = PduType> = PduForType<T>['content'];

export function isTimelineEventType(type: PduType) {
	return (
		type === 'm.room.message' ||
		type === 'm.room.encrypted' ||
		type === 'm.reaction' ||
		type === 'm.room.redaction'
	);
}

export function isStateEventType(type: PduType) {
	return (
		type === 'm.room.create' ||
		type === 'm.room.member' ||
		type === 'm.room.join_rules' ||
		type === 'm.room.power_levels' ||
		type === 'm.room.aliases' ||
		type === 'm.room.history_visibility' ||
		type === 'm.room.guest_access' ||
		type === 'm.room.server_acl' ||
		type === 'm.room.topic' ||
		type === 'm.room.name' ||
		type === 'm.room.avatar' ||
		type === 'm.room.canonical_alias' ||
		type === 'm.room.encryption' ||
		type === 'm.room.tombstone' ||
		type === 'm.room.pinned_events'
	);
}
