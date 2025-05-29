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
} from "../../types/v1";

import {
	type PduCreateEventV3,
	type PduJoinRuleEventV3,
	type PduMembershipEventV3,
	type PduPowerLevelsEventV3,
	type PduPowerLevelsEventV3Content,
	type PduV3,
} from "../../types/v3";

import { getStateMapKey, isPowerEvent } from "./definitions";
import { type EventID, type StateMapKey } from "../../types/_common";

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

function getPowerLevel(
	event?: PduV3 & PduPowerLevelsEventV3Content,
): (PduV3 & PduPowerLevelsEventV3Content) | undefined {
	return (
		event && {
			...event,
			...{
				content: {
					...event.content,
					ban: event.content.ban ?? 50,
					invite: event.content.invite ?? 0,
					kick: event.content.kick ?? 50,
					redact: event.content.redact ?? 50,
					state_default: event.content.state_default ?? 50,
					events_default: event.content.events_default ?? 0,
					users_default: event.content.users_default ?? 0,
				},
			},
		}
	);
}

function isCreateAllowed(event: PduV3) {
	return true; // synapse just allows this event, maybe because it also sends event that doesn't conform to the spec

	// uncomment for spec compliance
	// If it has any prev_events, reject.
	/* if (event.prev_events.length > 0) {
      return false;
    }

    // If the domain of the room_id does not match the domain of the sender, reject.
    if (extractDomain(event.room_id) !== extractDomain(event.sender)) {
      return false;
    }

    // If content.room_version is assert(verifier(event as V2Pdu, authEvents), "not allowed"present and is not a recognised version, reject.
    if (event.content.room_version && event.content.room_version !== "2") {
      // FIXME: room_version should have the right grammar verifiaction
      // TODO: only now support version 2+
      return false;
    }

    // If content has no creator property, reject.
    if (!event.content.creator) {
      return false;
    }
    // If it has any prev_events, reject.
    /* if (event.prev_events.length > 0) {
      return false;
    }

    // If the domain of the room_id does not match the domain of the sender, reject.
    if (extractDomain(event.room_id) !== extractDomain(event.sender)) {
      return false;
    }

    // If content.room_version is assert(verifier(event as V2Pdu, authEvents), "not allowed"present and is not a recognised version, reject.
    if (event.content.room_version && event.content.room_version !== "2") {
      // FIXME: room_version should have the right grammar verifiaction
      // TODO: only now support version 2+
      return false;
    }

    // If content has no creator property, reject.
    if (!event.content.creator) {
      return false;
    }

    return true; */
}

// TODO: better typing for alias event
function isRoomAliasAllowed(event: PduV3) {
	// If event has no state_key, reject.
	if (!event.state_key) {
		return false;
	}

	// If sender’s domain doesn’t matches state_key, reject.
	if (extractDomain(event.sender) !== event.state_key) {
		return false;
	}

	return true;
}

export function getPowerLevelForUser(
	userId: string,
	powerLevelEvent?: PduPowerLevelsEventV3,
	roomCreateEvent?: PduCreateEventV3,
) {
	if (powerLevelEvent) {
		const userPowerLevel = powerLevelEvent.content.users?.[userId];
		if (userPowerLevel) {
			return userPowerLevel;
		}

		// check for users_default
		const usersDefault = powerLevelEvent.content.users_default;
		if (usersDefault) {
			return usersDefault;
		}
	}

	// no event so defaults
	//     // NOTE: When there is no m.room.power_levels event in the room, the room creator has a power level of 100, and all other users have a power level of 0.
	if (roomCreateEvent?.content.creator === userId) {
		return 100;
	}

	return 0;
}

export function getPowerLevelForEvent(
	event: PduV3,
	powerLevelEvent: PduV3 & PduPowerLevelsEventV3Content = {
		content: {},
	} as PduV3 & PduPowerLevelsEventV3Content,
) {
	const userPowerLevel = powerLevelEvent.content.events?.[event.type];
	if (userPowerLevel) {
		return userPowerLevel;
	}

	// state_default || events_default
	// TODO: better way to know if state event?
	if (event.type === PduTypeRoomMessage) {
		return powerLevelEvent.content.events_default ?? 0;
	}

	return powerLevelEvent.content.state_default ?? 50;
}

function isMembershipChangeAllowed(
	event: PduMembershipEventV3,
	authEventStateMap: Map<EventID, PduV3>,
): boolean {
	// If there is no state_key property, or no membership property in content, reject.
	if (!event.state_key || !event.content.membership) {
		return false;
	}

	// sender -> who asked for the change
	// state_key -> whose state is asked to change

	// sender information, like does this user have permission?
	const sender = event.sender;
	const senderMembership = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomMember, state_key: sender }),
	) as PduMembershipEventV3 | undefined;

	// user to be invited
	const invitee = event.state_key;
	const inviteeMembership = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomMember, state_key: invitee }),
	) as PduMembershipEventV3 | undefined;

	//   const roomEvent = authEventMap.get(getStateMapKey({ type: PDUType.Create })) as PDUCreateEvent;
	//   const room = {
	// 	  join_rules: roomEvent?.content.join_rules,
	//   } as const;
	const joinRuleEvent = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomJoinRules }),
	) as PduJoinRuleEventV3;
	const joinRule = joinRuleEvent?.content.join_rule;

	const powerLevelEvent = getPowerLevel(
		authEventStateMap.get(
			getStateMapKey({ type: PduTypeRoomPowerLevels }),
		) as PduPowerLevelsEventV3,
	);

	const roomCreateEvent = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomCreate }),
	) as PduCreateEventV3 | undefined;

	switch (event.content.membership) {
		case "join": {
			if (senderMembership?.content.membership === "join") {
				return true; // ?
			}

			// If the only previous event is an m.room.create and the state_key is the creator, allow.
			if (event.prev_events?.length === 1) {
				const prevEvent = authEventStateMap.get(event.prev_events[0]);

				return prevEvent
					? isCreateEvent(prevEvent) && prevEvent.state_key === event.state_key
					: false;
			}

			// If the sender does not match state_key, reject.
			if (sender !== invitee) {
				return false;
			}

			// If the sender is banned, reject.
			if (senderMembership?.content.membership === "ban") {
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
			// If content has a third_party_invite property:
			if (event.content.third_party_invite) {
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
			if (senderMembership?.content.membership !== "join") {
				return false;
			}

			// If target user’s current membership state is join or ban, reject.
			if (
				inviteeMembership?.content.membership === "join" ||
				inviteeMembership?.content.membership === "ban"
			) {
				return false;
			}

			// If the sender’s power level is greater than or equal to the invite level, allow.
			const senderPowerLevel = getPowerLevelForUser(
				sender,
				powerLevelEvent,
				roomCreateEvent,
			);
			//  The level required to invite a user. Defaults to 0 if unspecified.
			const inviteLevel = powerLevelEvent?.content.invite ?? 0;

			if (senderPowerLevel >= inviteLevel) {
				return true;
			}

			return false;
		}

		case "leave": {
			// If the sender matches state_key, allow if and only if that user’s current membership state is invite or join.
			if (
				sender === invitee &&
				(inviteeMembership?.content.membership === "invite" ||
					inviteeMembership?.content.membership === "join")
			) {
				return true;
			}

			// If the sender’s current membership state is not join, reject.
			if (senderMembership?.content.membership !== "join") {
				return false;
			}

			// If the target user’s current membership state is ban, and the sender’s power level is less than the ban level, reject.
			const senderPowerLevel = getPowerLevelForUser(
				sender,
				powerLevelEvent,
				roomCreateEvent,
			);
			// defaults to 50 if not specified
			const banLevel = powerLevelEvent?.content.ban ?? 50;
			if (
				inviteeMembership?.content.membership === "ban" &&
				senderPowerLevel < banLevel
			) {
				return false;
			}

			// If the sender’s power level is greater than or equal to the kick level, and the target user’s power level is less than the sender’s power level, allow.
			const kickRequiredLevel = powerLevelEvent?.content.kick ?? 50;
			if (
				senderPowerLevel >= kickRequiredLevel &&
				getPowerLevelForUser(invitee, powerLevelEvent, roomCreateEvent) <
					senderPowerLevel
			) {
				return true;
			}

			return false;
		}

		case "ban": {
			// If the sender’s current membership state is not join, reject.
			if (senderMembership?.content.membership !== "join") {
				return false;
			}

			// If the sender’s power level is greater than or equal to the ban level, and the target user’s power level is less than the sender’s power level, allow.
			const senderPowerLevel = getPowerLevelForUser(
				sender,
				powerLevelEvent,
				roomCreateEvent,
			);
			// defaults to 50 if not specified
			const banLevel = powerLevelEvent?.content.ban ?? 50;
			if (
				senderPowerLevel >= banLevel &&
				getPowerLevelForUser(invitee, powerLevelEvent, roomCreateEvent) <
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
	event: PduPowerLevelsEventV3,
	authEventMap: Map<EventID, PduV3>,
) {
	// If the users property in content is not an object with keys that are valid user IDs with values that are integers (or a string that is an integer), reject.
	// If there is no previous m.room.power_levels event in the room, allow.
	const existingPowerLevel = authEventMap.get(
		getStateMapKey({ type: PduTypeRoomPowerLevels }),
	) as PduPowerLevelsEventV3 | undefined;

	const newPowerLevel = event;

	if (!existingPowerLevel) {
		return true;
	}

	const roomCreateEvent = authEventMap.get(
		getStateMapKey({ type: PduTypeRoomCreate }),
	) as PduCreateEventV3 | undefined;

	const senderPowerLevel = getPowerLevelForUser(
		event.sender,
		existingPowerLevel,
		roomCreateEvent,
	);

	// For each found alteration:

	// If the current value is greater than the sender’s current power level, reject.
	// If the new value is greater than the sender’s current power level, reject.

	if (
		existingPowerLevel.content.users_default !== event.content.users_default
	) {
		if (
			event.content.users_default &&
			event.content.users_default > senderPowerLevel
		) {
			return false;
		}

		if (
			existingPowerLevel.content.users_default &&
			existingPowerLevel.content.users_default > senderPowerLevel
		) {
			return false;
		}
	}

	if (
		existingPowerLevel.content.events_default !== event.content.events_default
	) {
		if (
			event.content.events_default &&
			event.content.events_default > senderPowerLevel
		) {
			return false;
		}

		if (
			existingPowerLevel.content.events_default &&
			existingPowerLevel.content.events_default > senderPowerLevel
		) {
			return false;
		}
	}

	if (
		existingPowerLevel.content.state_default !== event.content.state_default
	) {
		if (
			event.content.state_default &&
			event.content.state_default > senderPowerLevel
		) {
			return false;
		}

		if (
			existingPowerLevel.content.state_default &&
			existingPowerLevel.content.state_default > senderPowerLevel
		) {
			return false;
		}
	}

	// for ban
	if (existingPowerLevel.content.ban !== event.content.ban) {
		if (event.content.ban && event.content.ban > senderPowerLevel) {
			return false;
		}

		if (
			existingPowerLevel.content.ban &&
			existingPowerLevel.content.ban > senderPowerLevel
		) {
			return false;
		}
	}

	// for kick
	if (existingPowerLevel.content.kick !== event.content.kick) {
		if (event.content.kick && event.content.kick > senderPowerLevel) {
			return false;
		}

		if (
			existingPowerLevel.content.kick &&
			existingPowerLevel.content.kick > senderPowerLevel
		) {
			return false;
		}
	}

	// for redact
	if (existingPowerLevel.content.redact !== event.content.redact) {
		if (event.content.redact && event.content.redact > senderPowerLevel) {
			return false;
		}

		if (
			existingPowerLevel.content.redact &&
			existingPowerLevel.content.redact > senderPowerLevel
		) {
			return false;
		}
	}

	// for invite
	if (existingPowerLevel.content.invite !== event.content.invite) {
		if (event.content.invite && event.content.invite > senderPowerLevel) {
			return false;
		}

		if (
			existingPowerLevel.content.invite &&
			existingPowerLevel.content.invite > senderPowerLevel
		) {
			return false;
		}
	}

	// 4. For each entry being changed in, or removed from, the events property:
	const existingPowerLevelEvents = Object.keys(
		existingPowerLevel.content.events ?? {},
	);
	for (const eventType of existingPowerLevelEvents) {
		if (
			!newPowerLevel.content.events?.[eventType] ||
			newPowerLevel.content.events?.[eventType] !==
				existingPowerLevel.content.events[eventType]
		) {
			// changed or removed
			// If the current value is greater than the sender’s current power level, reject.
			if (existingPowerLevel.content.events?.[eventType] > senderPowerLevel) {
				return false;
			}
		}
	}

	// 5. For each entry being added to, or changed in, the events property:
	const newPowerLevelEvents = Object.keys(newPowerLevel.content.events ?? {});
	for (const eventType of newPowerLevelEvents) {
		if (
			!existingPowerLevel.content.events?.[eventType] ||
			newPowerLevel.content.events?.[eventType] !==
				existingPowerLevel.content.events[eventType]
		) {
			// changed or added
			// If the new value is greater than the sender’s current power level, reject.
			if (newPowerLevel.content.events?.[eventType] > senderPowerLevel) {
				return false;
			}
		}
	}

	// do same for users
	// 6. For each entry being changed in, or removed from, the users property, other than the sender’s own entry:
	const existingPowerLevelUsers = Object.keys(
		existingPowerLevel.content.users ?? {},
	);

	for (const userId of existingPowerLevelUsers) {
		if (
			userId !== event.sender &&
			(!newPowerLevel.content.users?.[userId] ||
				newPowerLevel.content.users?.[userId] !==
					existingPowerLevel.content.users[userId])
		) {
			// changed or removed
			// If the current value is greater than the sender’s current power level, reject.
			if (existingPowerLevel.content.users?.[userId] > senderPowerLevel) {
				return false;
			}
		}
	}

	// 7. For each entry being changed in, or removed from, the users property:
	const newPowerLevelUsers = Object.keys(newPowerLevel.content.users ?? {});
	for (const userId of newPowerLevelUsers) {
		if (
			!existingPowerLevel.content.users?.[userId] ||
			newPowerLevel.content.users?.[userId] !==
				existingPowerLevel.content.users[userId]
		) {
			// changed or added
			// If the new value is greater than the sender’s current power level, reject.
			if (newPowerLevel.content.users?.[userId] > senderPowerLevel) {
				return false;
			}
		}
	}

	return true;
}

// autheventmap as described here https://spec.matrix.org/v1.12/server-server-api/#auth-events-selection
// could call it a sub-state, which is why using the same type as State
export function isAllowedEvent(
	event: PduV3,
	authEventStateMap: Map<EventID, PduV3>,
): boolean {
	if (isCreateEvent(event)) {
		return true;
		// return isCreateAllowed(event);
	}

	if (event.type === PduTypeRoomCanonicalAlias) {
		return isRoomAliasAllowed(event);
	}

	if (isMembershipEvent(event)) {
		return isMembershipChangeAllowed(event, authEventStateMap);
	}

	// If the sender’s current membership state is not join, reject.
	const senderMembership = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomMember, state_key: event.sender }),
	) as PduMembershipEventV3 | undefined;
	if (senderMembership && senderMembership.content.membership !== "join") {
		return false;
	}

	// If type is m.room.third_party_invite:
	if (event.type === PduTypeRoomThirdPartyInvite) {
		console.warn("third_party_invite not implemented");
		return false;
	}

	const powerLevelEvent = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomPowerLevels }),
	) as PduPowerLevelsEventV3 | undefined;
	const roomCreateEvent = authEventStateMap.get(
		getStateMapKey({ type: PduTypeRoomCreate }),
	) as PduCreateEventV3 | undefined;

	// If the event type’s required power level is greater than the sender’s power level, reject.
	const eventRequiredPowerLevel = getPowerLevelForEvent(event, powerLevelEvent);
	const userPowerLevel = getPowerLevelForUser(
		event.sender,
		powerLevelEvent,
		roomCreateEvent,
	);

	if (userPowerLevel < eventRequiredPowerLevel) {
		return false;
	}

	// If the event has a state_key that starts with an @ and does not match the sender, reject.
	if (event.state_key?.startsWith("@") && event.state_key !== event.sender) {
		return false;
	}

	// If type is m.room.power_levels:
	if (isPowerLevelsEvent(event)) {
		return validatePowerLevelEvent(event, authEventStateMap);
	}

	// TODO: redaction

	// 12. otherwise allow
	return true;
}
