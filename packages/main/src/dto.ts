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
