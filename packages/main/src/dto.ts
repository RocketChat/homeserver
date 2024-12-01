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
