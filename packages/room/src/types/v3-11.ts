import { z } from 'zod';

// Copied from: https://github.com/element-hq/synapse/blob/2277df2a1eb685f85040ef98fa21d41aa4cdd389/synapse/api/constants.py#L103-L141
export const PduTypeRoomMember = 'm.room.member' as const;
export const PduTypeRoomCreate = 'm.room.create' as const;
export const PduTypeRoomTombstone = 'm.room.tombstone' as const;
export const PduTypeRoomJoinRules = 'm.room.join_rules' as const;
export const PduTypeRoomPowerLevels = 'm.room.power_levels' as const;
export const PduTypeRoomAliases = 'm.room.aliases' as const;
export const PduTypeRoomRedaction = 'm.room.redaction' as const;
export const PduTypeRoomThirdPartyInvite = 'm.room.third_party_invite' as const;
export const PduTypeRoomHistoryVisibility =
	'm.room.history_visibility' as const;
export const PduTypeRoomCanonicalAlias = 'm.room.canonical_alias' as const;
export const PduTypeRoomEncrypted = 'm.room.encrypted' as const;
export const PduTypeRoomAvatar = 'm.room.avatar' as const;
export const PduTypeRoomEncryption = 'm.room.encryption' as const;
export const PduTypeRoomGuestAccess = 'm.room.guest_access' as const;
export const PduTypeRoomMessage = 'm.room.message' as const;
export const PduTypeRoomTopic = 'm.room.topic' as const;
export const PduTypeRoomName = 'm.room.name' as const;
export const PduTypeRoomServerACL = 'm.room.server_acl' as const;
export const PduTypeRoomPinned = 'm.room.pinned_events' as const;
export const PduTypeRoomRetention = 'm.room.retention' as const;
export const PduTypeDummy = 'org.matrix.dummy_event' as const;
export const PduTypeSpaceChild = 'm.space.child' as const;
export const PduTypeSpaceParent = 'm.space.parent' as const;
export const PduTypeReaction = 'm.reaction' as const;
export const PduTypeSticker = 'm.sticker' as const;
export const PduTypeLiveLocationShareStart = 'm.beacon_info' as const;
export const PduTypeCallInvite = 'm.call.invite' as const;
export const PduTypePollStart = 'm.poll.start' as const;
export const EduTypePresence = 'm.presence' as const;
export const EduTypeTyping = 'm.typing' as const;
export const EduTypeReceipt = 'm.receipt' as const;
export const EduTypeDeviceListUpdate = 'm.device_list_update' as const;
export const EduTypeSigningKeyUpdate = 'm.signing' as const;
export const EduTypeUnstableSigningKeyUpdate =
	'org.matrix.signing_key_update' as const;
export const EduTypeDirectToDevice = 'm.direct_to_device' as const;

export const PduTypeSchema = z.enum([
	PduTypeRoomMember,
	PduTypeRoomCreate,
	PduTypeRoomTombstone,
	PduTypeRoomJoinRules,
	PduTypeRoomPowerLevels,
	PduTypeRoomAliases,
	PduTypeRoomRedaction,
	PduTypeRoomThirdPartyInvite,
	PduTypeRoomHistoryVisibility,
	PduTypeRoomCanonicalAlias,
	PduTypeRoomEncrypted,
	PduTypeRoomAvatar,
	PduTypeRoomEncryption,
	PduTypeRoomGuestAccess,
	PduTypeRoomMessage,
	PduTypeRoomTopic,
	PduTypeRoomName,
	PduTypeRoomServerACL,
	PduTypeRoomPinned,
	PduTypeRoomRetention,
	PduTypeDummy,
	PduTypeSpaceChild,
	PduTypeSpaceParent,
	PduTypeReaction,
	PduTypeSticker,
	PduTypeLiveLocationShareStart,
	PduTypeCallInvite,
	PduTypePollStart,
]);
export const EduTypeSchema = z.enum([
	EduTypePresence,
	EduTypeTyping,
	EduTypeReceipt,
	EduTypeDeviceListUpdate,
	EduTypeSigningKeyUpdate,
	EduTypeUnstableSigningKeyUpdate,
	EduTypeDirectToDevice,
]);

export type PduType = z.infer<typeof PduTypeSchema>;
export type EduType = z.infer<typeof EduTypeSchema>;
export type EventType = PduType | EduType;

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
		.string()
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
	reason: z.string(),
	redacts: z.string().describe('event id'),
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

export const PduMessageEventContentSchema = z.object({
	body: z.string().describe('The body of the message.'),
	// TODO: add more types
	msgtype: z.enum(['m.text', 'm.image']).describe('The type of the message.'),
	// Optional fields for message edits and relations aka threads
	'm.relates_to': z
		.object({
			rel_type: z
				.enum(['m.replace', 'm.annotation', 'm.thread'])
				.describe('The type of the relation.')
				.optional(),
			event_id: z
				.string()
				.optional()
				.describe('The ID of the event that is being related to.'),
			is_falling_back: z
				.boolean()
				.optional()
				.describe('Whether this is a fallback for older clients'),
			'm.in_reply_to': z
				.object({
					event_id: z
						.string()
						.describe('The ID of the latest event in the thread for fallback'),
				})
				.optional(),
			key: z.string().optional().describe('The key for reactions (emoji).'),
		})
		.optional()
		.describe('Relation information for edits, replies, reactions, etc.'),
	'm.new_content': z
		.object({
			body: z.string().describe('The new body of the message for edits.'),
			msgtype: z
				.enum(['m.text', 'm.image'])
				.describe('The type of the new message content.'),
			format: z
				.enum(['org.matrix.custom.html'])
				.describe('The format of the message content.')
				.optional(),
			formatted_body: z
				.string()
				.describe('The formatted body of the message.')
				.optional(),
		})
		.optional()
		.describe('The new content for message edits.'),
	format: z
		.enum(['org.matrix.custom.html'])
		.describe('The format of the message content.')
		.optional(),
	formatted_body: z
		.string()
		.describe('The formatted body of the message.')
		.optional(),
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
		.array(z.string())
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
	origin: z.string().describe('The origin of the event.').optional(),
	origin_server_ts: z
		.number()
		.describe(
			'The timestamp of the event. This is a number that is the number of milliseconds since the Unix epoch.',
		),
	prev_events: z
		.array(z.string())
		.describe(
			'A list of event IDs that are required in the room state before this event can be applied. The server will not send this event if it is not satisfied.',
		),
	redacts: z
		.string()
		.describe(
			'The ID of the event that this event redacts. This is an optional field.',
		)
		.optional(),
	room_id: z
		.string()
		.describe(
			'The ID of the room that the event is in. This is a unique identifier for the room.',
		),
	sender: z
		.string()
		.describe(
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
	state_key: z
		.string()
		.describe('The state key of the event. This is an optional field.'),
};

export function generatePduSchemaForBase<T, S>(stateBase: T, timelineBase: S) {
	return z.discriminatedUnion('type', [
		z.object({
			type: z.literal(PduTypeRoomCreate),
			content: PduCreateEventContentSchema,
			...stateBase,
		}),

		z.object({
			...stateBase,
			type: z.literal(PduTypeRoomMember),
			content: PduMembershipEventContentSchema,
		}),

		z.object({
			...stateBase,
			type: z.literal(PduTypeRoomJoinRules),
			content: PduJoinRuleEventContentSchema,
		}),

		z.object({
			...stateBase,
			type: z.literal(PduTypeRoomPowerLevels),
			content: PduPowerLevelsEventContentSchema,
		}),

		z.object({
			...stateBase,
			type: z.literal(PduTypeRoomCanonicalAlias),
			content: PduCanonicalAliasEventContentSchema,
		}),

		z.object({
			...stateBase,
			type: z.literal(PduTypeRoomName),
			content: PduRoomNameEventContentSchema,
		}),

		z.object({
			...stateBase,
			type: z.literal(PduTypeRoomAliases),
			content: PduCanonicalAliasEventContentSchema,
		}),

		z.object({
			...stateBase,
			type: z.literal(PduTypeRoomTopic),
			content: PduRoomTopicEventContentSchema,
		}),

		z.object({
			...stateBase,
			type: z.literal(PduTypeRoomHistoryVisibility),
			content: PduHistoryVisibilityEventContentSchema,
		}),

		z.object({
			...stateBase,
			type: z.literal(PduTypeRoomGuestAccess),
			content: PduGuestAccessEventContentSchema,
		}),

		z.object({
			...timelineBase,
			type: z.literal(PduTypeRoomMessage),
			content: PduMessageEventContentSchema,
		}),

		z.object({
			...timelineBase,
			type: z.literal(PduTypeReaction),
			content: PduMessageReactionEventContentSchema,
		}),

		z.object({
			...timelineBase,
			type: z.literal(PduTypeRoomRedaction),
			content: PduRoomRedactionContentSchema,
		}),
	]);
}

export const PduSchema = generatePduSchemaForBase(
	PduNoContentStateEventSchema,
	PduNoContentTimelineEventSchema,
);

export type Pdu = z.infer<typeof PduSchema>;

export type PduContent = Pick<Pdu, 'content'>['content'];

export function isTimelineEventType(type: PduType) {
	return (
		type === PduTypeRoomMessage ||
		type === PduTypeReaction ||
		type === PduTypeRoomRedaction
	);
}
