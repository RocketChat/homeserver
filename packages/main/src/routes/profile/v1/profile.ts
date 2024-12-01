import { Elysia, t } from "elysia";

export const profileEndpoints = new Elysia().get(
	"/query/profile",
	({ query }) => ({
		avatar_url: "mxc://matrix.org/MyC00lAvatar",
		displayname: query.user_id,
	}),
	{
		query: t.Object({
			/**
			 * The field to query. If specified, the server will only return the given field in the response. If not
			 * specified, the server will return the full profile for the user.
			 */
			field: t.Optional(t.UnionEnum(["displayname", "avatar_url"])),
			/** The user ID to query. Must be a user local to the receiving homeserver. */
			user_id: t.String(),
		}),
	},
);
