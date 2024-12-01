import { FormatRegistry } from "@sinclair/typebox";
import { t } from "elysia";

const MAX_USER_ID_LENGTH = 255;

FormatRegistry.Set("user_id", isUserID);

function isUserID(userID: string) {
	const match = userID.match(/^@(?<localpart>[^:]+):(?<domain>.+)$/);

	if (!match || !match.groups) {
		return false;
	}

	const { domain } = match.groups;

	const matchDomain = domain.match(/^(?<hostname>[^:]+)(:(?<port>\d+))?$/);

	if (!matchDomain || !matchDomain.groups) {
		return false;
	}

	return true;
}

export const UserIDDTO = t.String({
	format: "user_id",
	maxLength: MAX_USER_ID_LENGTH,
	error: "Invalid user ID format. Must be in the format '@localpart:domain'",
	description:
		"The user ID to query. Must be a user local to the receiving homeserver.",
});

export const KeysDTO = t.Object(
	{
		server_name: t.String({
			description:
				"The homeserver's [server name](https://spec.matrix.org/latest/appendices/#server-name).",
			examples: ["example.org"],
		}),
		valid_until_ts: t.Integer({
			format: "int64",
			description:
				"POSIX timestamp in milliseconds when the list of valid keys should be refreshed.\nThis field MUST be ignored in room versions 1, 2, 3, and 4. Keys used beyond this\ntimestamp MUST be considered invalid, depending on the\n[room version specification](/rooms).\n\nServers MUST use the lesser of this field and 7 days into the future when\ndetermining if a key is valid. This is to avoid a situation where an attacker\npublishes a key which is valid for a significant amount of time without a way\nfor the homeserver owner to revoke it.",
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
						description:
							"The [Unpadded base64](/appendices/#unpadded-base64) encoded key.",
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
						description:
							"The [Unpadded base64](https://spec.matrix.org/latest/appendices/#unpadded-base64) encoded key.",
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

export const InviteEventDTO = t.Object(
	{
		sender: t.String({
			description:
				"The matrix ID of the user who sent the original `m.room.third_party_invite`.",
			examples: ["@someone:example.org"],
		}),
		origin: t.String({
			description: "The name of the inviting homeserver.",
			examples: ["matrix.org"],
		}),
		origin_server_ts: t.Integer({
			format: "int64",
			description: "A timestamp added by the inviting homeserver.",
			examples: [1234567890],
		}),
		type: t.String({
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
					"The content of the event, matching what is available in the\n[Client-Server API](/client-server-api/). Must include a `membership` of `invite`.",
				examples: [
					{
						membership: "invite",
					},
				],
			},
		),
	},
	{
		description:
			"An invite event. Note that events have a different format depending on the\nroom version - check the [room version specification](/rooms) for precise event formats.",
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
