import { Elysia, t } from "elysia";
import { UserIDDTO } from "../../../dto";

export const queryEndpoints = new Elysia().get(
	"/query/profile",
	({ query }) => ({
		avatar_url: "mxc://matrix.org/MyC00lAvatar",
		displayname: query.user_id,
	}),
	{
		query: t.Object({
			field: t.Optional(
				t.UnionEnum(["displayname", "avatar_url"], {
					description:
						"The field to query. If specified, the server will only return the given field\nin the response. If not specified, the server will return the full profile for\nthe user.",
				}),
			),
			user_id: t.Intersect([UserIDDTO], {
				description:
					"The user ID to query. Must be a user local to the receiving homeserver.",
				example: "@someone:example.org",
			}),
		}),
		response: t.Object(
			{
				avatar_url: t.Optional(
					t.String({
						description:
							"The avatar URL for the user's avatar. May be omitted if the user does not\nhave an avatar set.",
						examples: ["mxc://matrix.org/MyC00lAvatar"],
					}),
				),
				displayname: t.Optional(
					t.String({
						description:
							"The display name of the user. May be omitted if the user does not have a\ndisplay name set.",
						examples: ["John Doe"],
					}),
				),
			},
			{
				description:
					"The profile for the user. If a `field` is specified in the request, only the\nmatching field should be included in the response. If no `field` was specified,\nthe response should include the fields of the user's profile that can be made\npublic, such as the display name and avatar.\n\nIf the user does not have a particular field set on their profile, the server\nshould exclude it from the response body or give it the value `null`.",
				examples: [
					{
						displayname: "John Doe",
						avatar_url: "mxc://matrix.org/MyC00lAvatar",
					},
				],
			},
		),
		detail: {
			description:
				"Performs a query to get profile information, such as a display name or avatar,\nfor a given user. Homeservers should only query profiles for users that belong\nto the target server (identified by the [server name](/appendices/#server-name)\nin the user ID).\n\nServers may wish to cache the response to this query to avoid requesting the\ninformation too often.\n\nServers MAY deny profile look-up over federation by responding with 403 and an\nerror code of `M_FORBIDDEN`.",
			operationId: "queryProfile",
		},
	},
);
