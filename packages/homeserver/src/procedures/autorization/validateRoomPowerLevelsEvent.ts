import type { EventBase } from "@hs/core/src/events/eventBase";
import {
	isRoomPowerLevelsEvent,
	type RoomPowerLevelsEvent,
} from "@hs/core/src/events/m.room.power_levels";
import { getUserPowerLevel } from "./ensureAuthorizationRules";
import { env } from "bun";

const isValidPowerLevel = (
	obj: unknown,
): obj is {
	[key: string]: number;
} => {
	if (typeof obj !== "object" || obj === null) {
		return false;
	}

	for (const key of Object.keys(obj)) {
		if (typeof key !== "string") {
			return false;
		}

		const powerLevel = key in obj && obj[key as keyof typeof obj];

		if (typeof powerLevel !== "number") {
			return false;
		}
	}

	return true;
};
const isValidUserPowerLevel = (
	obj: unknown,
): obj is {
	[key: string]: number;
} => {
	if (typeof obj !== "object" || obj === null) {
		return false;
	}

	for (const key of Object.keys(obj)) {
		if (typeof key !== "string") {
			return false;
		}
		const [user, server] = key.split(":");

		if (user.length === 0 || server.length === 0) {
			return false;
		}

		const powerLevel = key in obj && obj[key as keyof typeof obj];

		if (typeof powerLevel !== "number") {
			return false;
		}
	}

	return true;
};

export const validateRoomPowerLevelsEvent = async (
	event: RoomPowerLevelsEvent,
	authMap: Map<string, EventBase>,
) => {
	// 9.1 If users key in content is not a dictionary with keys that are valid user IDs with values that are integers (or a string that is an integer), reject.

	const users = event.content.users ?? {};

	if (!isValidUserPowerLevel(users)) {
		throw new Error("Invalid users");
	}

	for (const [key, value] of Object.entries(event.content)) {
		if (
			[
				"users_default",
				"events_default",
				"state_default",
				"ban",
				"redact",
				"kick",
				"invite",
			].includes(key) &&
			typeof value !== "number"
		) {
			throw new Error("Invalid keys");
		}

		if (["events", "notifications", "users"].includes(key)) {
			if (
				typeof value !== "object" ||
				value === null ||
				!isValidPowerLevel(value)
			) {
				throw new Error("Invalid keys");
			}
		}

		const authEvent = [...authMap.values()].find((authEvent) => {
			if (!isRoomPowerLevelsEvent(authEvent)) {
				return false;
			}
			return authEvent.state_key === event.state_key;
		}) as RoomPowerLevelsEvent | undefined;
		// 9.2 If there is no previous m.room.power_levels event in the room, allow.
		if (!authEvent) {
			return;
		}

		const userLevel = getUserPowerLevel(authEvent.sender, authMap);

		// 9.3 For the keys users_default, events_default, state_default, ban, redact, kick, invite check if they were added, changed or removed. For each found alteration:
		// 9.3.1 If the current value is higher than the sender’s current power level, reject.

		// 9.3.2 If the new value is higher than the sender’s current power level, reject.
		// 9.4 For each entry being added, changed or removed in both the events, users, and notifications keys:
		// 9.4.1 If the current value is higher than the sender’s current power level, reject.
		// 9.4.2 If the new value is higher than the sender’s current power level, reject.
		// 9.5For each entry being changed under the users key, other than the sender’s own entry:
		// 9.5.1 If the current value is equal to the sender’s current power level, reject.
		// 9.6 Otherwise, allow.

		// Check other levels
		const levelsToCheck: [string, string | null][] = [
			["users_default", null],
			["events_default", null],
			["state_default", null],
			["ban", null],
			["redact", null],
			["kick", null],
			["invite", null],
		];

		const oldUserList = authEvent.content.users || {};
		for (const user of new Set([
			...Object.keys(oldUserList),
			...Object.keys(users),
		])) {
			levelsToCheck.push([user, "users"]);
		}

		const oldEventList = authEvent.content.events || {};
		const newEventList = event.content.events || {};
		for (const eventId of new Set([
			...Object.keys(oldEventList),
			...Object.keys(newEventList),
		])) {
			levelsToCheck.push([eventId, "events"]);
		}

		const oldNotifications = authEvent.content.notifications || {};
		const newNotifications = event.content.notifications || {};
		for (const notifId of new Set([
			...Object.keys(oldNotifications),
			...Object.keys(newNotifications),
		])) {
			levelsToCheck.push([notifId, "notifications"]);
		}

		const oldState = authEvent.content;
		const newState = event.content;

		for (const [levelToCheck, dir] of levelsToCheck) {
			const oldLoc = dir
				? oldState[dir as keyof typeof oldState] || {}
				: oldState;
			const newLoc = dir
				? newState[dir as keyof typeof newState] || {}
				: newState;

			const oldLevel =
				oldLoc[levelToCheck as keyof typeof oldLoc] !== undefined
					? Number(oldLoc[levelToCheck as keyof typeof oldLoc])
					: null;
			const newLevel =
				newLoc[levelToCheck as keyof typeof newLoc] !== undefined
					? Number(newLoc[levelToCheck as keyof typeof newLoc])
					: null;

			if (newLevel !== null && oldLevel !== null && newLevel === oldLevel) {
				continue;
			}

			if (dir === "users" && levelToCheck !== event.sender) {
				if (oldLevel === userLevel) {
					throw new Error(
						"You don't have permission to remove ops level equal to your own",
					);
				}
			}

			const oldLevelTooBig = oldLevel !== null && oldLevel > userLevel;
			const newLevelTooBig = newLevel !== null && newLevel > userLevel;

			if (oldLevelTooBig || newLevelTooBig) {
				throw new Error("Invalid power level");
			}
		}
	}
};
