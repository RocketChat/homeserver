import assert from "node:assert";
import {
	isCreateEvent,
	isMembershipEvent,
	isPowerLevelsEvent,
	PduTypeRoomCanonicalAlias,
	PduTypeRoomCreate,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomMessage,
	PduTypeRoomPowerLevels,
	PduTypeRoomThirdPartyInvite,
	type PduCreateEventContent,
	type PduMembershipEvent,
	type PduMembershipEventContent,
	type PduPowerLevelsEventContent,
	type PduType,
} from "../types/v1";

import {
	type PduCreateEventV3,
	type PduJoinRuleEventV3,
	type PduMembershipEventV3,
	type PduPowerLevelsEventV3,
	type PduPowerLevelsEventV3Content,
	type PduV3,
} from "../types/v3";

import {
	getStateMapKey,
	isPowerEvent,
	type EventStore,
} from "../state_resolution/definitions/definitions";
import { type EventID, type StateMapKey } from "../types/_common";
import type { PersistentEventBase } from "../manager/event-manager";
import { join } from "node:path";
import type { PduPowerLevelsEventV10Content } from "../types/v10";

// https://spec.matrix.org/v1.12/rooms/v1/#authorization-rules
// skip if not any of the specified type of events
// function shouldSkip({ type }: { type: V2Pdu["type"] }) {
//   return ![
//     PDUType.Create,
//     PDUType.Member,
//     PDUType.JoinRules,
//     PDUType.PowerLevels,
//     PDUType.ThirdPartyInvite,
//   ].includes(type as PDUType); // FIXME: typing
// }

function extractDomain(identifier: string) {
	return identifier.split(":").pop();
}

export function getPowerLevelForUser(
	userId: string,
	roomCreateEvent: PersistentEventBase,
	powerLevelEvent?: PersistentEventBase,
) {
	if (!powerLevelEvent) {
		if (roomCreateEvent.sender === userId) {
			return 100;
		}

		return 0;
	}

	return powerLevelEvent.getPowerLevelForUser(userId, roomCreateEvent);
}

function isCreateAllowed(createEvent: PersistentEventBase) {
	// If it has any prev_events, reject.
	if (createEvent.event.prev_events.length > 0) {
		return false;
	}

	// If the domain of the room_id does not match the domain of the sender, reject.
	if (extractDomain(createEvent.roomId) !== extractDomain(createEvent.sender)) {
		return false;
	}

	const content = createEvent.getContent<PduCreateEventContent>();

	// If content.room_version is assert(verifier(event as V2Pdu, authEvents), "not allowed"present and is not a recognised version, reject.
	if (
		content.room_version &&
		!["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"].includes(
			content.room_version,
		)
	) {
		return false;
	}

	// If content has no creator property, reject.
	if (!content.creator) {
		return false;
	}

	return true;
}

// TODO: better typing for alias event
function isRoomAliasAllowed(roomAliasEvent: PersistentEventBase) {
	// If event has no state_key, reject.
	if (!roomAliasEvent.stateKey) {
		return false;
	}

	// If sender’s domain doesn’t matches state_key, reject.
	if (roomAliasEvent.domain !== roomAliasEvent.stateKey) {
		return false;
	}

	return true;
}

async function isMembershipChangeAllowed(
	membershipEvent: PersistentEventBase,
	authEventStateMap: Map<EventID, PersistentEventBase>,
	store: EventStore, // FIXME: shouldn't need to
): Promise<boolean> {
	// If there is no state_key property, or no membership property in content, reject.
	if (!membershipEvent.stateKey || !membershipEvent.getMembership()) {
		return false;
	}

	// sender -> who asked for the change
	// state_key -> whose state is asked to change

	// sender information, like does this user have permission?
	const sender = membershipEvent.sender;
	const senderMembership = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomMember, state_key: sender }),
	);

	// user to be invited
	const invitee = membershipEvent.stateKey;
	const inviteeMembership = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomMember, state_key: invitee }),
	);

	const joinRuleEvent = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomJoinRules }),
	);

	const joinRule = joinRuleEvent?.isJoinRuleEvent()
		? joinRuleEvent.getJoinRule()
		: undefined;

	const powerLevelEvent = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomPowerLevels }),
	);

	const roomCreateEvent = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomCreate }),
	);

	assert(roomCreateEvent, "room create event not found"); // must exist

	const content = membershipEvent.getContent<PduMembershipEventContent>();

	const previousEvents = await membershipEvent.getPreviousEvents(store);

	switch (content.membership) {
		case "join": {
			if (senderMembership?.getMembership() === "join") {
				return false; // don't override exising event
			}

			// If the only previous event is an m.room.create and the state_key is the creator, allow.
			if (previousEvents.length === 1) {
				const [event] = previousEvents;

				return (
					event.isCreateEvent() && event.stateKey === membershipEvent.stateKey
				);
			}

			// If the sender does not match state_key, reject.
			if (sender !== invitee) {
				return false;
			}

			// If the sender is banned, reject.
			if (senderMembership?.getMembership() === "ban") {
				return false;
			}

			// If the join_rule is invite then allow if membership state is invite or join.
			// If the join_rule is public, allow.
			if (joinRule === "invite" || joinRule === "public") {
				return true;
			}

			// otherwise reject
			return false;
		}

		case "invite": {
			const content = membershipEvent.getContent<PduMembershipEventContent>();
			// If content has a third_party_invite property:
			if (content.third_party_invite) {
				// // If target user is banned, reject.
				// if (inviteeMembership.content.membership === "ban") {
				// 	return false;
				// }

				// // If content.third_party_invite does not have a signed property, reject.
				// if (!event.content.third_party_invite.signed) {
				// 	return false;
				// }

				// // If signed does not have mxid and token properties, reject.
				// if (!event.content.third_party_invite.signed.mxi && !event.content.third_party_invite.token) {
				// 	return false;
				// }

				// // If mxid does not match state_key, reject.
				// if (event.content.third_party_invite.signed.mxid !== event.state_key) {
				// 	return false;
				// }

				// // If there is no m.room.third_party_invite event in the current room state with state_key matching token, reject.

				console.warn("third_party_invite not implemented");
				return false;
			}

			// If the sender’s current membership state is not join, reject.
			if (senderMembership?.getMembership() !== "join") {
				return false;
			}

			// If target user’s current membership state is join or ban, reject.
			if (
				inviteeMembership?.getMembership() === "join" ||
				inviteeMembership?.getMembership() === "ban"
			) {
				return false;
			}

			// If the sender’s power level is greater than or equal to the invite level, allow.
			const senderPowerLevel = getPowerLevelForUser(
				sender,
				roomCreateEvent,
				powerLevelEvent,
			);

			//  The level required to invite a user. Defaults to 0 if unspecified.
			const inviteLevel = powerLevelEvent?.getRequiredPowerForInvite() ?? 0;

			if (senderPowerLevel >= inviteLevel) {
				return true;
			}

			return false;
		}

		case "leave": {
			// If the sender matches state_key, allow if and only if that user’s current membership state is invite or join.
			if (
				sender === invitee &&
				(inviteeMembership?.getMembership() === "invite" ||
					inviteeMembership?.getMembership() === "join")
			) {
				return true;
			}

			// If the sender’s current membership state is not join, reject.
			if (senderMembership?.getMembership() !== "join") {
				return false;
			}

			// If the target user’s current membership state is ban, and the sender’s power level is less than the ban level, reject.
			const senderPowerLevel = getPowerLevelForUser(
				sender,
				roomCreateEvent,
				powerLevelEvent,
			);
			// defaults to 50 if not specified
			const banLevel = powerLevelEvent?.getRequiredPowerForBan() ?? 50;

			if (
				inviteeMembership?.getMembership() === "ban" &&
				senderPowerLevel < banLevel
			) {
				return false;
			}

			// If the sender’s power level is greater than or equal to the kick level, and the target user’s power level is less than the sender’s power level, allow.
			const kickRequiredLevel =
				powerLevelEvent?.getRequiredPowerForKick() ?? 50;
			if (
				senderPowerLevel >= kickRequiredLevel &&
				getPowerLevelForUser(invitee, roomCreateEvent, powerLevelEvent) <
					senderPowerLevel
			) {
				return true;
			}

			return false;
		}

		case "ban": {
			// If the sender’s current membership state is not join, reject.
			if (senderMembership?.getMembership() !== "join") {
				return false;
			}

			// If the sender’s power level is greater than or equal to the ban level, and the target user’s power level is less than the sender’s power level, allow.
			const senderPowerLevel = getPowerLevelForUser(
				sender,
				roomCreateEvent,
				powerLevelEvent,
			);
			// defaults to 50 if not specified
			const banLevel = powerLevelEvent?.getRequiredPowerForBan() ?? 50;
			if (
				senderPowerLevel >= banLevel &&
				getPowerLevelForUser(invitee, roomCreateEvent, powerLevelEvent) <
					senderPowerLevel
			) {
				return true;
			}

			return false;
		}

		default:
			// unknown
			return false;
	}
}

function validatePowerLevelEvent(
	powerLevelEvent: PersistentEventBase,
	roomCreateEvent: PersistentEventBase,
	authEventMap: Map<EventID, PersistentEventBase>,
) {
	// If the users property in content is not an object with keys that are valid user IDs with values that are integers (or a string that is an integer), reject.
	// If there is no previous m.room.power_levels event in the room, allow.
	const existingPowerLevel = authEventMap.get(
		getStateMapKey({ type: PduTypeRoomPowerLevels }),
	);

	const newPowerLevel = powerLevelEvent;

	if (!existingPowerLevel) {
		// allow if no previous power level event
		return true;
	}

	const senderPowerLevel = getPowerLevelForUser(
		powerLevelEvent.sender,
		roomCreateEvent,
		existingPowerLevel,
	);

	// For each found alteration:

	// If the current value is greater than the sender’s current power level, reject.
	// If the new value is greater than the sender’s current power level, reject.

	if (
		existingPowerLevel.getPowerLevelUserDefaultValue() !==
		newPowerLevel.getPowerLevelUserDefaultValue()
	) {
		const newPowerLevelValue = newPowerLevel.getPowerLevelUserDefaultValue();
		if (newPowerLevelValue && newPowerLevelValue > senderPowerLevel) {
			return false;
		}

		const existingPowerLevelValue =
			existingPowerLevel.getPowerLevelUserDefaultValue();

		if (existingPowerLevelValue && existingPowerLevelValue > senderPowerLevel) {
			return false;
		}
	}

	const newPowerLevelEventsDefaultValue =
		newPowerLevel.getPowerLevelEventsDefaultValue();
	const existingPowerLevelEventsDefaultValue =
		existingPowerLevel.getPowerLevelEventsDefaultValue();

	if (
		existingPowerLevelEventsDefaultValue !== newPowerLevelEventsDefaultValue
	) {
		if (
			newPowerLevelEventsDefaultValue &&
			newPowerLevelEventsDefaultValue > senderPowerLevel
		) {
			return false;
		}

		if (
			existingPowerLevelEventsDefaultValue &&
			existingPowerLevelEventsDefaultValue > senderPowerLevel
		) {
			return false;
		}
	}

	const newPowerLevelStateDefaultValue =
		newPowerLevel.getPowerLevelStateDefaultValue();
	const existingPowerLevelStateDefaultValue =
		existingPowerLevel.getPowerLevelStateDefaultValue();

	if (existingPowerLevelStateDefaultValue !== newPowerLevelStateDefaultValue) {
		if (
			newPowerLevelStateDefaultValue &&
			newPowerLevelStateDefaultValue > senderPowerLevel
		) {
			return false;
		}

		if (
			existingPowerLevelStateDefaultValue &&
			existingPowerLevelStateDefaultValue > senderPowerLevel
		) {
			return false;
		}
	}

	const newPowerLevelBanValue = newPowerLevel.getPowerLevelBanValue();
	const existingPowerLevelBanValue = existingPowerLevel.getPowerLevelBanValue();

	// for ban
	if (existingPowerLevelBanValue !== newPowerLevelBanValue) {
		if (newPowerLevelBanValue && newPowerLevelBanValue > senderPowerLevel) {
			return false;
		}

		if (
			existingPowerLevelBanValue &&
			existingPowerLevelBanValue > senderPowerLevel
		) {
			return false;
		}
	}

	const newPowerLevelKickValue = newPowerLevel.getPowerLevelKickValue();
	const existingPowerLevelKickValue =
		existingPowerLevel.getPowerLevelKickValue();

	// for kick
	if (existingPowerLevelKickValue !== newPowerLevelKickValue) {
		if (newPowerLevelKickValue && newPowerLevelKickValue > senderPowerLevel) {
			return false;
		}

		if (
			existingPowerLevelKickValue &&
			existingPowerLevelKickValue > senderPowerLevel
		) {
			return false;
		}
	}

	// for redact
	const newPowerLevelRedactValue = newPowerLevel.getPowerLevelRedactValue();
	const existingPowerLevelRedactValue =
		existingPowerLevel.getPowerLevelRedactValue();

	if (existingPowerLevelRedactValue !== newPowerLevelRedactValue) {
		if (
			newPowerLevelRedactValue &&
			newPowerLevelRedactValue > senderPowerLevel
		) {
			return false;
		}

		if (
			existingPowerLevelRedactValue &&
			existingPowerLevelRedactValue > senderPowerLevel
		) {
			return false;
		}
	}

	// for invite
	const newPowerLevelInviteValue = newPowerLevel.getPowerLevelInviteValue();
	const existingPowerLevelInviteValue =
		existingPowerLevel.getPowerLevelInviteValue();

	if (existingPowerLevelInviteValue !== newPowerLevelInviteValue) {
		if (
			newPowerLevelInviteValue &&
			newPowerLevelInviteValue > senderPowerLevel
		) {
			return false;
		}

		if (
			existingPowerLevelInviteValue &&
			existingPowerLevelInviteValue > senderPowerLevel
		) {
			return false;
		}
	}

	const existingPowerLevelContent =
		existingPowerLevel.getContent<PduPowerLevelsEventContent>();
	const newPowerLevelContent =
		newPowerLevel.getContent<PduPowerLevelsEventContent>();

	// 4. For each entry being changed in, or removed from, the events property:
	const existingPowerLevelEvents = Object.keys(
		existingPowerLevelContent.events ?? {},
	);
	for (const eventType of existingPowerLevelEvents) {
		const existingPowerLevelValue = existingPowerLevel.getPowerLevelEventsValue(
			eventType as PduType,
		);
		const newPowerLevelValue = newPowerLevel.getPowerLevelEventsValue(
			eventType as PduType,
		);
		if (!newPowerLevelValue || newPowerLevelValue !== existingPowerLevelValue) {
			// changed or removed
			// If the current value is greater than the sender’s current power level, reject.
			if (
				existingPowerLevelValue &&
				existingPowerLevelValue > senderPowerLevel
			) {
				return false;
			}
		}
	}

	// 5. For each entry being added to, or changed in, the events property:
	const newPowerLevelEvents = Object.keys(newPowerLevelContent.events ?? {});
	for (const eventType of newPowerLevelEvents) {
		const existingPowerLevelValue = existingPowerLevel.getPowerLevelEventsValue(
			eventType as PduType,
		);
		const newPowerLevelValue = newPowerLevel.getPowerLevelEventsValue(
			eventType as PduType,
		);
		if (!newPowerLevelValue || newPowerLevelValue !== existingPowerLevelValue) {
			// changed or added
			// If the new value is greater than the sender’s current power level, reject.
			if (newPowerLevelValue && newPowerLevelValue > senderPowerLevel) {
				return false;
			}
		}
	}

	// do same for users
	// 6. For each entry being changed in, or removed from, the users property, other than the sender’s own entry:
	const existingPowerLevelUsers = Object.keys(
		existingPowerLevelContent.users ?? {},
	);

	for (const userId of existingPowerLevelUsers) {
		const existingPowerLevelValue =
			existingPowerLevel.getPowerLevelUsersValue(userId);
		const newPowerLevelValue = newPowerLevel.getPowerLevelUsersValue(userId);
		if (
			userId !== powerLevelEvent.sender &&
			(!newPowerLevelValue || newPowerLevelValue !== existingPowerLevelValue)
		) {
			// changed or removed
			// If the current value is greater than the sender’s current power level, reject.
			if (
				existingPowerLevelValue &&
				existingPowerLevelValue > senderPowerLevel
			) {
				return false;
			}
		}
	}

	// 7. For each entry being changed in, or removed from, the users property:
	const newPowerLevelUsers = Object.keys(newPowerLevelContent.users ?? {});
	for (const userId of newPowerLevelUsers) {
		const existingPowerLevelValue =
			existingPowerLevel.getPowerLevelUsersValue(userId);
		const newPowerLevelValue = newPowerLevel.getPowerLevelUsersValue(userId);
		if (
			!existingPowerLevelValue ||
			newPowerLevelValue !== existingPowerLevelValue
		) {
			// changed or added
			// If the new value is greater than the sender’s current power level, reject.
			if (newPowerLevelValue && newPowerLevelValue > senderPowerLevel) {
				return false;
			}
		}
	}

	return true;
}

function isDuplicateAuthEvent(
	event: PersistentEventBase,
	authEventStateMap: Map<EventID, PersistentEventBase>,
) {}

// autheventmap as described here https://spec.matrix.org/v1.12/server-server-api/#auth-events-selection
// could call it a sub-state, which is why using the same type as State
export async function isAllowedEvent(
	event: PersistentEventBase,
	store: EventStore,
): Promise<boolean> {
	// Considering the event’s auth_events:
	//
	const authEvents = await event.getAuthorizationEvents(store);

	// keys we need
	const authEventStateKeysNeeded = event.getAuthEventStateKeys();

	// duplicates can be through ids and hashes, so must resolve them
	const _authEventStateMap = new Map<StateMapKey, PersistentEventBase | null>(
		authEventStateKeysNeeded.map((key) => [key, null]),
	);

	for (const authEvent of authEvents) {
		// If there are entries which were themselves rejected under the checks performed on receipt of a PDU, reject.
		if (authEvent.rejected) {
			throw new Error("auth event rejected");
		}

		// If there are duplicate entries for a given type and state_key pair, reject.
		const key = authEvent.getUniqueStateIdentifier();
		if (_authEventStateMap.has(key)) {
			const existingEvent = _authEventStateMap.get(key);

			if (existingEvent !== null) {
				throw new Error("duplicate auth event");
			}

			_authEventStateMap.set(key, authEvent);
		}

		// if stateMap does not have the key, this is an excess auth event
		throw new Error("excess auth event");
	}

	const authEventStateMap = _authEventStateMap as Map<
		StateMapKey,
		PersistentEventBase
	>;

	// If there are entries whose type and state_key don’t match those specified by the auth events selection algorithm described in the server specification, reject.
	for (const key of authEventStateKeysNeeded) {
		if (!authEventStateMap.has(key)) {
			// reject cause we don't have the auth event we need
			return false;
		}
	}

	if (event.isCreateEvent()) {
		return isCreateAllowed(event);
	}

	// If there is no m.room.create event among the entries, reject.
	// there should be one unless it's a create event
	const roomCreateEvent = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomCreate }),
	);
	if (!roomCreateEvent) {
		return false;
	}

	// If the content of the m.room.create event in the room state has the property m.federate set to false, and the sender domain of the event does not match the sender domain of the create event, reject.
	if (
		roomCreateEvent.getContent<PduCreateEventContent>()["m.federate"] ===
			false &&
		event.domain !== roomCreateEvent.domain
	) {
		return false;
	}

	if (event.isCanonicalAliasEvent()) {
		return isRoomAliasAllowed(event);
	}

	if (event.isMembershipEvent()) {
		return isMembershipChangeAllowed(event, authEventStateMap, store);
	}

	// If the sender’s current membership state is not join, reject.
	const senderMembership = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomMember, state_key: event.sender }),
	);
	if (senderMembership?.getMembership() !== "join") {
		return false;
	}

	// If type is m.room.third_party_invite:
	if (event.type === PduTypeRoomThirdPartyInvite) {
		console.warn("third_party_invite not implemented");
		return false;
	}

	const powerLevelEvent = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomPowerLevels }),
	);

	assert(powerLevelEvent, "power level event not found"); // has to be one at this point

	// If the event type’s required power level is greater than the sender’s power level, reject.
	const eventRequiredPowerLevel = powerLevelEvent.getRequiredPowerLevelForEvent(
		event.type,
	);
	const userPowerLevel = getPowerLevelForUser(
		event.sender,
		roomCreateEvent,
		powerLevelEvent,
	);

	if (userPowerLevel < eventRequiredPowerLevel) {
		return false;
	}

	// If the event has a state_key that starts with an @ and does not match the sender, reject.
	if (event.stateKey?.startsWith("@") && event.stateKey !== event.sender) {
		return false;
	}

	// If type is m.room.power_levels:
	if (event.isPowerLevelEvent()) {
		return validatePowerLevelEvent(event, roomCreateEvent, authEventStateMap);
	}

	// TODO: redaction

	// 12. otherwise allow
	return true;
}
