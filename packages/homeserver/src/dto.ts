import { t } from "elysia";

const MAX_USER_ID_LENGTH = 255;

// function isUserID(userID: string) {
// 	const match = userID.match(/^@(?<localpart>[^:]+):(?<domain>.+)$/);

// 	if (!match || !match.groups) {
// 		return false;
// 	}

// 	const { domain } = match.groups;

// 	const matchDomain = domain.match(/^(?<hostname>[^:]+)(:(?<port>\d+))?$/);

// 	if (!matchDomain || !matchDomain.groups) {
// 		return false;
// 	}

// 	return true;
// }

export const UserIDDTO = t.String({
	maxLength: MAX_USER_ID_LENGTH,
	error: "Invalid user ID format. Must be in the format '@localpart:domain'",
});

export const KeysDTO = t.Object(
	{
		server_name: t.String({
			description: "The homeserver's server name.",
			examples: ["example.org"],
		}),
		valid_until_ts: t.Integer({
			format: "int64",
			description:
				"POSIX timestamp in milliseconds when the list of valid keys should be refreshed.\nThis field MUST be ignored in room versions 1, 2, 3, and 4. Keys used beyond this\ntimestamp MUST be considered invalid, depending on the\nroom version specification.\n\nServers MUST use the lesser of this field and 7 days into the future when\ndetermining if a key is valid. This is to avoid a situation where an attacker\npublishes a key which is valid for a significant amount of time without a way\nfor the homeserver owner to revoke it.",
			examples: [1052262000000],
		}),
		old_verify_keys: t.Record(
			t.String(),
			t.Object(
				{
					expired_ts: t.Integer({
						format: "int64",
						description:
							"POSIX timestamp in milliseconds for when this key expired.",
						examples: [1532645052628],
					}),
					key: t.String({
						description: "The Unpadded base64 encoded key.",
						examples: [
							"VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg",
						],
					}),
				},
				{
					title: "Old Verify Key",
				},
			),
			{
				description:
					"The public keys that the server used to use and when it stopped using them.\n\nThe object's key is the algorithm and version combined (`ed25519` being the\nalgorithm and `0ldK3y` being the version in the example below). Together,\nthis forms the Key ID. The version must have characters matching the regular\nexpression `[a-zA-Z0-9_]`.",

				examples: [
					{
						"ed25519:0ldk3y": {
							expired_ts: 1532645052628,
							key: "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg",
						},
					},
				],
			},
		),
		verify_keys: t.Record(
			t.String(),
			t.Object(
				{
					key: t.String({
						description: "The Unpadded base64 encoded key.",
						examples: ["VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9hZA"],
					}),
				},
				{
					title: "Verify Key",
				},
			),
			{
				description:
					"Public keys of the homeserver for verifying digital signatures.\n\nThe object's key is the algorithm and version combined (`ed25519` being the\nalgorithm and `abc123` being the version in the example below). Together,\nthis forms the Key ID. The version must have characters matching the regular\nexpression `[a-zA-Z0-9_]`.",
				examples: [
					{
						"ed25519:abc123": {
							key: "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9hZA",
						},
					},
				],
			},
		),
		signatures: t.Record(
			t.String(),
			t.Record(
				t.String(),
				t.String({
					description: "A signature of the server's public key by the key id",
				}),
			),
			{
				description:
					"Digital signatures for this object signed using the verify_keys. The signature is calculated using the process described at Signing JSON",
				examples: [
					{
						"example.org": {
							"ed25519:auto2":
								"VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1cmU",
						},
					},
				],
			},
		),
	},
	{
		description: "The homeserver's keys",
		examples: [
			{
				server_name: "example.org",
				verify_keys: {
					"ed25519:abc123": {
						key: "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9hZA",
					},
				},
				old_verify_keys: {
					"ed25519:0ldk3y": {
						expired_ts: 1532645052628,
						key: "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg",
					},
				},
				signatures: {
					"example.org": {
						"ed25519:auto2": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1cmU",
					},
				},
				valid_until_ts: 1652262000000,
			},
		],
	},
);

export const StrippedStateDTO = t.Object(
	{
		content: t.Object(
			{},
			{ title: "EventContent", description: "The `content` for the event." },
		),
		state_key: t.String({
			description: "The `state_key` for the event.",
		}),
		type: t.String({
			description: "The `type` for the event.",
		}),
		sender: t.String({
			description: "The `sender` for the event.",
		}),
	},
	{
		title: "StrippedStateEvent",
		description:
			"A stripped down state event, with only the `type`, `state_key`,\n`sender`, and `content` keys.",
	},
);

export const ErrorDTO = t.Object({
	errcode: t.String({
		description: "An error code.",
		examples: ["M_UNKNOWN"],
	}),
	error: t.String({
		description: "A human-readable error message.",
		examples: ["An unknown error occurred"],
	}),
});

export const EventBaseDTO = t.Object({
	auth_events: t.Array(t.String()),
	prev_events: t.Array(t.String()),
	type: t.String(),
	room_id: t.String(),
	sender: t.String(),
	content: t.Object({}),
	depth: t.Number(),
	state_key: t.String(),
	origin: t.String(),
	origin_server_ts: t.Number(),
	hashes: t.Object({
		sha256: t.String(),
	}),
	signatures: t.Record(
		t.String(),
		t.Record(t.String(), t.String(), {
			title: "Server Signatures",
		}),
	),
	unsigned: t.Optional(
		t.Object({
			age: t.Integer({
				description:
					"The time in milliseconds that has elapsed since the event was sent.",
			}),
		}),
	),
});

export const EventHashDTO = t.Object(
	{
		sha256: t.String({
			description: "The hash.",
			example: "ThisHashCoversAllFieldsInCaseThisIsRedacted",
		}),
	},
	{
		title: "Event Hash",
		description:
			"Content hashes of the PDU, following the algorithm specified in Signing Events.",
		examples: [
			{
				sha256: "ThisHashCoversAllFieldsInCaseThisIsRedacted",
			},
		],
	},
);

export const PersistentDataUnitDTO = t.Object(
	{
		room_id: t.String({
			description: "Room identifier.",
			examples: ["!abc123:matrix.org"],
		}),
		sender: t.String({
			description: "The ID of the user sending the event.",
			examples: ["@someone:matrix.org"],
		}),
		origin_server_ts: t.Integer({
			format: "int64",
			description:
				"Timestamp in milliseconds on origin homeserver when this event was created.",
			examples: [1234567890],
		}),
		type: t.String({
			description: "Event type",
			examples: ["m.room.message"],
		}),
		state_key: t.Optional(
			t.String({
				description:
					"If this key is present, the event is a state event, and it will replace previous events\nwith the same `type` and `state_key` in the room state.",
				examples: ["my_key"],
			}),
		),
		content: t.Object(
			{},
			{
				description: "The content of the event.",
				examples: [
					{
						key: "value",
					},
				],
			},
		),
		depth: t.Integer({
			description:
				"The maximum depth of the `prev_events`, plus one. Must be less than the\nmaximum value for an integer (2^63 - 1). If the room's depth is already at\nthe limit, the depth must be set to the limit.",
			examples: [12],
		}),
		unsigned: t.Optional(
			t.Object(
				{
					age: t.Integer({
						description:
							"The number of milliseconds that have passed since this message was sent.",
						examples: [4612],
					}),
				},
				{
					title: "UnsignedData",
					description:
						"Additional data added by the origin server but not covered by the `signatures`.",
					examples: [
						{
							key: "value",
						},
					],
				},
			),
		),
		hashes: EventHashDTO,
		signatures: t.Record(
			t.String(),
			t.Record(t.String(), t.String(), {
				title: "Server Signatures",
			}),
			{
				description:
					"Signatures for the PDU, following the algorithm specified in Signing Events.",
				examples: [
					{
						"example.com": {
							"ed25519:key_version:": "86BytesOfSignatureOfTheRedactedEvent",
						},
					},
				],
			},
		),
		redacts: t.Optional(
			t.String({
				description:
					"For redaction events, the ID of the event being redacted.",
				examples: ["$def_456-oldevent"],
			}),
		),
		auth_events: t.Array(
			t.String({
				description: "Event ID.",
			}),
			{
				description:
					"Event IDs for the authorization events that would\nallow this event to be in the room.\n\nMust contain less than or equal to 10 events. Note that if the relevant\nauth event selection rules are used, this restriction should never be\nencountered.",
				examples: ["$URLsafe-base64EncodedHash", "$Another_Event"],
			},
		),
		prev_events: t.Array(t.String({ description: "Event ID." }), {
			description:
				"Event IDs for the most recent events in the room\nthat the homeserver was aware of when it made this event.\n\nMust contain less than or equal to 20 events.",
			examples: ["$URLsafe-base64EncodedHash", "$Another_Event"],
		}),
	},
	{
		title: "Persistent Data Unit",
		description:
			"A persistent data unit (event) for room version 4 and beyond.",
		examples: [
			{
				room_id: "!UcYsUzyxTGDxLBEvLy:example.org",
				sender: "@alice:example.com",
				origin_server_ts: 1404838188000,
				depth: 12,
				type: "m.room.message",
				content: {
					key: "value",
				},
				unsigned: {
					age: 4612,
				},
				hashes: {
					sha256: "thishashcoversallfieldsincasethisisredacted",
				},
				signatures: {
					"example.com": {
						"ed25519:key_version:":
							"these86bytesofbase64signaturecoveressentialfieldsincludinghashessocancheckredactedpdus",
					},
				},
				auth_events: [
					"$urlsafe_base64_encoded_eventid",
					"$a-different-event-id",
				],
				prev_events: [
					"$urlsafe_base64_encoded_eventid",
					"$a-different-event-id",
				],
				redacts: "$some-old_event",
			},
		],
	},
);

export const InviteEventDTO = t.Composite(
	[
		PersistentDataUnitDTO,
		t.Object({
			sender: t.String({
				description:
					"The matrix ID of the user who sent the original `m.room.third_party_invite`.",
				examples: ["@someone:example.org"],
			}),
			origin: t.String({
				description: "The name of the inviting homeserver.",
				examples: ["matrix.org"],
			}),
			type: t.Literal("m.room.member", {
				description: "The value `m.room.member`.",
				examples: ["m.room.member"],
			}),
			state_key: t.String({
				description: "The user ID of the invited member.",
				examples: ["@joe:elsewhere.com"],
			}),
			content: t.Object(
				{
					membership: t.String({
						description: "The value `invite`.",
						examples: ["invite"],
					}),
				},
				{
					title: "Membership Event Content",
					description:
						"The content of the event, matching what is available in the\nClient-Server API. Must include a `membership` of `invite`.",
					examples: [
						{
							membership: "invite",
						},
					],
				},
			),
		}),
	],
	{
		description:
			"An invite event. Note that events have a different format depending on the\nroom version - check the room version specification for precise event formats.",
	},
);

const EventDTO = t.Object(
	{
		content: t.Object(
			{},
			{
				description:
					"The fields in this object will vary depending on the type of event. When interacting with the REST API, this is the HTTP body.",
			},
		),
		type: t.String({
			description:
				"The type of event. This SHOULD be namespaced similar to Java package naming conventions e.g. 'com.example.subdomain.event.type'",
		}),
	},
	{
		title: "Event",
		description: "The basic set of fields all events must have.",
	},
);

const UnsignedDataDTO = t.Object(
	{
		age: t.Integer({
			description:
				"The time in milliseconds that has elapsed since the event was sent.",
		}),
	},
	{
		title: "UnsignedData",
		description: "Contains optional extra information about the event.",
	},
);

const SyncRoomEventDTO = t.Composite(
	[
		EventDTO,
		t.Object({
			event_id: t.String({
				description: "The globally unique event identifier.",
			}),
			sender: t.String({
				description:
					"Contains the fully-qualified ID of the user who sent this event.",
			}),
			origin_server_ts: t.Integer({
				description:
					"Timestamp in milliseconds on originating homeserver when this event was sent.",
				format: "int64",
			}),
			unsigned: t.Optional(UnsignedDataDTO),
		}),
	],
	{
		title: "SyncRoomEvent",
		description:
			"In addition to the Event fields, Room Events have the following additional fields.",
	},
);

const RoomEventDTO = t.Composite(
	[
		SyncRoomEventDTO,
		t.Object({
			room_id: t.String({
				description:
					"The ID of the room associated with this event. Will not be present on events\nthat arrive through `/sync`, despite being required everywhere else.",
			}),
		}),
	],
	{
		title: "RoomEvent",
		description: "Room Events have the following fields.",
	},
);

const SyncStateEventDTO = t.Composite(
	[
		SyncRoomEventDTO,
		t.Object({
			state_key: t.String({
				description:
					"A unique key which defines the overwriting semantics for this piece of room state. This value is often a zero-length string. The presence of this key makes this event a State Event.\nState keys starting with an `@` are reserved for referencing user IDs, such as room members. With the exception of a few events, state events set with a given user's ID as the state key MUST only be set by that user.",
			}),
		}),
	],
	{
		title: "SyncStateEvent",
		description:
			"In addition to the Room Event fields, State Events have the following additional fields.",
	},
);

const StateEventDTO = t.Composite([RoomEventDTO, SyncStateEventDTO], {
	title: "StateEvent",
	description: "State Events have the following fields.",
});

const MRoomMemberDTO = t.Composite(
	[
		StateEventDTO,
		t.Object({
			content: t.Object(
				{
					avatar_url: t.Optional(
						t.String({
							description: "The avatar URL for this user, if any.",
							format: "uri",
						}),
					),
					displayname: t.Optional(
						t.Nullable(
							t.String({
								description: "The display name for this user, if any.",
							}),
						),
					),
					membership: t.UnionEnum(["invite", "join", "knock", "leave", "ban"], {
						description: "The membership state of the user.",
					}),
					is_direct: t.Optional(
						t.Boolean({
							description:
								"Flag indicating if the room containing this event was created with the intention of being a direct chat. See [Direct Messaging](/client-server-api/#direct-messaging).",
						}),
					),
					join_authorised_via_users_server: t.Optional(
						t.String({
							description:
								"Usually found on `join` events, this field is used to denote which homeserver (through representation of a user with sufficient power level)\nauthorised the user's join. More information about this field can be found in the [Restricted Rooms Specification](/client-server-api/#restricted-rooms).\n\nClient and server implementations should be aware of the [signing implications](/rooms/v8/#authorization-rules) of including this\nfield in further events: in particular, the event must be signed by the server which\nowns the user ID in the field. When copying the membership event's `content`\n(for profile updates and similar) it is therefore encouraged to exclude this\nfield in the copy, as otherwise the event might fail event authorization.",
						}),
					),
					reason: t.Optional(
						t.String({
							description:
								"Optional user-supplied text for why their membership has changed. For kicks and bans, this is typically the reason for the kick or ban.\nFor other membership changes, this is a way for the user to communicate their intent without having to send a message to the room, such\nas in a case where Bob rejects an invite from Alice about an upcoming concert, but can't make it that day.\n\nClients are not recommended to show this reason to users when receiving an invite due to the potential for spam and abuse. Hiding the\nreason behind a button or other component is recommended.",
						}),
					),
					third_party_invite: t.Optional(
						t.Object(
							{
								display_name: t.String({
									description:
										"A name which can be displayed to represent the user instead of their third-party identifier",
								}),
								signed: t.Object(
									{
										mxid: t.String({
											description:
												"The invited matrix user ID. Must be equal to the user_id property of the event.",
										}),
										signatures: t.Record(
											t.String(),
											t.Record(t.String(), t.String()),
											{
												title: "Signatures",
												description:
													"A single signature from the verifying server, in the format specified by the Signing Events section of the server-server API.",
											},
										),
										token: t.String({
											description:
												"The token property of the containing third_party_invite object.",
										}),
									},
									{
										title: "signed",
										description:
											"A block of content which has been signed, which servers can use to verify the event. Clients should ignore this.",
									},
								),
							},
							{
								title: "Invite",
							},
						),
					),
				},
				{
					title: "EventContent",
				},
			),
			state_key: t.String({
				description:
					"The `user_id` this membership event relates to. In all cases except for when `membership` is\n`join`, the user ID sending the event does not need to match the user ID in the `state_key`,\nunlike other events. Regular authorisation rules still apply.",
			}),
			type: t.Literal("m.room.member"),
			unsigned: t.Composite([
				UnsignedDataDTO,
				t.Object({
					invite_room_state: t.Optional(
						t.Array(StrippedStateDTO, {
							description:
								"A subset of the state of the room at the time of the invite, if `membership` is `invite`.\nNote that this state is informational, and SHOULD NOT be trusted; once the client has\njoined the room, it SHOULD fetch the live state from the server and discard the\ninvite_room_state. Also, clients must not rely on any particular state being present here;\nthey SHOULD behave properly (with possibly a degraded but not a broken experience) in\nthe absence of any particular events here. If they are set on the room, at least the\nstate for `m.room.avatar`, `m.room.canonical_alias`, `m.room.join_rules`, and `m.room.name`\nSHOULD be included.",
						}),
					),
					knock_room_state: t.Optional(
						t.Array(StrippedStateDTO, {
							description:
								"A subset of the state of the room at the time of the knock, if `membership` is `knock`.\nThis has the same restrictions as `invite_room_state`. If they are set on the room, at least\nthe state for `m.room.avatar`, `m.room.canonical_alias`, `m.room.join_rules`, `m.room.name`,\nand `m.room.encryption` SHOULD be included.",
						}),
					),
				}),
			]),
		}),
	],
	{
		title: "The current membership state of a user in the room.",
		description:
			"Adjusts the membership state for a user in a room. It is preferable to use the membership APIs (`/rooms/<room id>/invite` etc) when performing membership actions rather than adjusting the state directly as there are a restricted set of valid transformations. For example, user A cannot force user B to join a room, and trying to force this state change directly will fail.\n\nThe following membership states are specified:\n\n- `invite` - The user has been invited to join a room, but has not yet joined it. They may not participate in the room until they join.\n- `join` - The user has joined the room (possibly after accepting an invite), and may participate in it.\n- `leave` - The user was once joined to the room, but has since left (possibly by choice, or possibly by being kicked).\n- `ban` - The user has been banned from the room, and is no longer allowed to join it until they are un-banned from the room (by having their membership state set to a value other than `ban`).\n- `knock` - The user has knocked on the room, requesting permission to participate. They may not participate in the room until they join.\n\nThe `third_party_invite` property will be set if this invite is an `invite` event and is the successor of an `m.room.third_party_invite` event, and absent otherwise.\n\nThis event may also include an `invite_room_state` key inside the event's `unsigned` data.\nIf present, this contains an array of [stripped state events](/client-server-api/#stripped-state)\nto assist the receiver in identifying the room.\n\nThe user for which a membership applies is represented by the `state_key`. Under some conditions,\nthe `sender` and `state_key` may not match - this may be interpreted as the `sender` affecting\nthe membership state of the `state_key` user.\n\nThe `membership` for a given user can change over time. The table below represents the various changes\nover time and how clients and servers must interpret those changes. Previous membership can be retrieved\nfrom the `prev_content` object on an event. If not present, the user's previous membership must be assumed\nas `leave`.\n\n|                   | to `invite`          | to `join`                              | to `leave`                                                                                                                              | to `ban`                    | to `knock`           |\n|-------------------|----------------------|----------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|-----------------------------|----------------------|\n| **from `invite`** | No change.           | User joined the room.                  | If the `state_key` is the same as the `sender`, the user rejected the invite. Otherwise, the `state_key` user had their invite revoked. | User was banned.            | User is re-knocking. |\n| **from `join`**   | Must never happen.   | `displayname` or `avatar_url` changed. | If the `state_key` is the same as the `sender`, the user left. Otherwise, the `state_key` user was kicked.                              | User was kicked and banned. | Must never happen.   |\n| **from `leave`**  | New invitation sent. | User joined.                           | No change.                                                                                                                              | User was banned.            | User is knocking.    |\n| **from `ban`**    | Must never happen.   | Must never happen.                     | User was unbanned.                                                                                                                      | No change.                  | Must never happen.   |\n| **from `knock`**  | Knock accepted.      | Must never happen.                     | If the `state_key` is the same as the `sender`, the user retracted the knock. Otherwise, the `state_key` user had their knock denied.   | User was banned.            | No change.           |",
	},
);
