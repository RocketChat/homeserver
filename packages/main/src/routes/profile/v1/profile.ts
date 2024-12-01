import { Elysia, t } from "elysia";
import { UserIDDTO } from "../../../dto";

export const profileEndpoints = new Elysia().get(
	"/query/profile",
	({ query }) => ({
		avatar_url: "mxc://matrix.org/MyC00lAvatar",
		displayname: query.user_id,
	}),
	{
		query: t.Object({
			field: t.Optional(
				t.UnionEnum(["displayname", "avatar_url"], {
					description: "The field to query.",
				}),
			),
			user_id: UserIDDTO,
		}),
		response: t.Object({
			avatar_url: t.Optional(
				t.String({
					description: "The avatar URL for the user’s avatar.",
				}),
			),
			displayname: t.Optional(
				t.String({
					description: "The display name of the user.",
				}),
			),
		}),
	},
);
