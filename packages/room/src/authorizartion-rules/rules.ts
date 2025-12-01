import assert from 'node:assert';
import { type PduType } from '../types/v3-11';

import type { PersistentEventBase } from '../manager/event-wrapper';
import { PowerLevelEvent } from '../manager/power-level-event-wrapper';
import { RoomVersion } from '../manager/type';
import {
	type EventStore,
	getStateByMapKey,
} from '../state_resolution/definitions/definitions';
import { type StateMapKey } from '../types/_common';
import { RejectCodes, StateResolverAuthorizationError } from './errors';

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
	return identifier.split(':').pop();
}

function isCreateAllowed(
	createEvent: PersistentEventBase<RoomVersion, 'm.room.create'>,
) {
	// If it has any prev_events, reject.
	if (createEvent.event.prev_events.length > 0) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: createEvent,
			reason: 'm.room.create event has prev_events',
		});
	}

	// If the domain of the room_id does not match the domain of the sender, reject.
	if (extractDomain(createEvent.roomId) !== extractDomain(createEvent.sender)) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: createEvent,
			reason: 'm.room.create event sender domain does not match room_id domain',
		});
	}

	const content = createEvent.getContent();

	// If content.room_version is assert(verifier(event as V2Pdu, authEvents), "not allowed"present and is not a recognised version, reject.
	if (
		content.room_version &&
		!['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'].includes(
			content.room_version,
		)
	) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: createEvent,
			reason: `m.room.create event content.room_version is not a recognised version ${content.room_version}`,
		});
	}

	// If content has no creator property, reject.
	if (!content.creator) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: createEvent,
			reason: 'm.room.create event content has no creator property',
		});
	}
}

// TODO: better typing for alias event
function isRoomAliasAllowed(
	roomAliasEvent: PersistentEventBase<RoomVersion, 'm.room.aliases'>,
): void {
	// If event has no state_key, reject.
	if (!roomAliasEvent.stateKey) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: roomAliasEvent,
			reason: 'm.room.canonical_alias event has no state_key',
		});
	}

	// If sender’s domain doesn’t matches state_key, reject.
	if (roomAliasEvent.origin !== roomAliasEvent.stateKey) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: roomAliasEvent,
			reason:
				'm.room.canonical_alias event sender domain does not match state_key',
		});
	}

	return;
}

async function isMembershipChangeAllowed(
	membershipEventToCheck: PersistentEventBase<RoomVersion, 'm.room.member'>,
	authEventStateMap: Map<StateMapKey, PersistentEventBase>,
	store: EventStore,
): Promise<void> {
	// If there is no state_key property, or no membership property in content, reject.
	if (
		!membershipEventToCheck.stateKey ||
		!membershipEventToCheck.isMembershipEvent()
	) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: membershipEventToCheck,
			reason: 'm.room.member event has no state_key or membership property',
		});
	}

	// sender -> who asked for the change
	// state_key -> whose state is asked to change

	// sender information, like does this user have permission?
	const sender = membershipEventToCheck.sender;
	const senderMembershipEvent = getStateByMapKey(authEventStateMap, {
		type: 'm.room.member',
		state_key: sender,
	});

	const senderMembership = senderMembershipEvent?.getMembership();

	// user to be invited
	const invitee = membershipEventToCheck.stateKey;
	const inviteeMembershipEvent = getStateByMapKey(authEventStateMap, {
		type: 'm.room.member',
		state_key: invitee,
	});

	const inviteeMembership = inviteeMembershipEvent?.getMembership();

	const joinRuleEvent = getStateByMapKey(authEventStateMap, {
		type: 'm.room.join_rules',
	});

	const joinRule = joinRuleEvent?.isJoinRuleEvent()
		? joinRuleEvent.getJoinRule()
		: undefined;

	const powerLevelEventInAuthStateMap = getStateByMapKey(authEventStateMap, {
		type: 'm.room.power_levels',
	});

	const powerLevelEvent = powerLevelEventInAuthStateMap?.isPowerLevelEvent()
		? PowerLevelEvent.fromEvent(powerLevelEventInAuthStateMap)
		: PowerLevelEvent.fromDefault();

	const roomCreateEvent = getStateByMapKey(authEventStateMap, {
		type: 'm.room.create',
	});

	assert(roomCreateEvent, 'room create event not found'); // must exist

	const content = membershipEventToCheck.getContent();

	const previousEvents = await store.getEvents(
		membershipEventToCheck.getPreviousEventIds(),
	);

	switch (content.membership) {
		case 'join': {
			// if (senderMembershipEvent?.getMembership() === "join") {
			// 	throw new StateResolverAuthorizationError(
			// 		"sender is already a member",
			// 		{
			// 			eventFailed: membershipEventToCheck,
			// 		},
			// 	);
			// }

			// If the only previous event is an m.room.create and the state_key is the creator, allow.
			if (previousEvents.length === 1) {
				const [event] = previousEvents;

				if (
					event.isCreateEvent() &&
					event.getContent().creator === membershipEventToCheck.stateKey
				) {
					return;
				}
			}

			// If the sender does not match state_key, reject.
			if (sender !== invitee) {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: membershipEventToCheck,
					reason: 'state_key does not match the sender',
				});
			}

			// If the sender is banned, reject.
			if (senderMembership === 'ban') {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: membershipEventToCheck,
					reason: 'sender is banned',
					rejectedBy: senderMembershipEvent,
				});
			}

			// If the join_rule is public, allow.
			if (joinRule === 'public') {
				return;
			}

			// If the join_rule is invite then allow if membership state is invite or join.
			if (joinRule === 'invite') {
				if (inviteeMembership === 'invite' || inviteeMembership === 'join') {
					return;
				}

				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: membershipEventToCheck,
					rejectedBy: joinRuleEvent,
					reason: 'join_rule is invite but membership is not invite or join',
				});
			}

			// otherwise reject
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: membershipEventToCheck,
				rejectedBy: joinRuleEvent,
				reason: 'join_rule is not public or invite',
			});
		}

		case 'invite': {
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

				throw new StateResolverAuthorizationError(RejectCodes.NotImplemented, {
					rejectedEvent: membershipEventToCheck,
					reason: 'third_party_invite not implemented',
				});
			}

			// If the sender’s current membership state is not join, reject.
			if (senderMembership !== 'join') {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: membershipEventToCheck,
					reason: 'sender is not part of the room',
					rejectedBy: senderMembershipEvent,
				});
			}

			// If target user’s current membership state is join or ban, reject.
			if (inviteeMembership === 'join' || inviteeMembership === 'ban') {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: membershipEventToCheck,
					reason: 'invitee is already join or ban',
					rejectedBy: inviteeMembershipEvent,
				});
			}

			// If the sender’s power level is greater than or equal to the invite level, allow.
			const senderPowerLevel = powerLevelEvent.getPowerLevelForUser(
				sender,
				roomCreateEvent,
			);

			//  The level required to invite a user. Defaults to 0 if unspecified.
			const inviteLevel = powerLevelEvent.getRequiredPowerForInvite();

			if (senderPowerLevel >= inviteLevel) {
				return;
			}

			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: membershipEventToCheck,
				reason: `sender power level is less than invite level (${senderPowerLevel} < ${inviteLevel})`,
				rejectedBy: powerLevelEvent.toEventBase(),
			});
		} // If the sender does not match state_key,

		case 'leave': {
			// If the sender matches state_key, allow if and only if that user’s current membership state is invite or join.
			if (
				sender === invitee &&
				(inviteeMembership === 'invite' ||
					inviteeMembership === 'join' ||
					inviteeMembership === 'leave')
			) {
				return;
			}

			// If the sender’s current membership state is not join, reject.
			if (senderMembership !== 'join') {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: membershipEventToCheck,
					reason: 'sender is not join',
					rejectedBy: senderMembershipEvent,
				});
			}

			// If the target user’s current membership state is ban, and the sender’s power level is less than the ban level, reject.
			const senderPowerLevel = powerLevelEvent.getPowerLevelForUser(
				sender,
				roomCreateEvent,
			);
			// defaults to 50 if not specified
			const banLevel = powerLevelEvent.getRequiredPowerForBan();

			if (inviteeMembership === 'ban' && senderPowerLevel < banLevel) {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: membershipEventToCheck,
					reason: 'sender power level is less than ban level',
					rejectedBy: powerLevelEvent.toEventBase(),
				});
			}

			// If the sender’s power level is greater than or equal to the kick level, and the target user’s power level is less than the sender’s power level, allow.
			const kickRequiredLevel = powerLevelEvent.getRequiredPowerForKick();
			if (
				senderPowerLevel >= kickRequiredLevel &&
				powerLevelEvent.getPowerLevelForUser(invitee, roomCreateEvent) <
					senderPowerLevel
			) {
				return;
			}

			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: membershipEventToCheck,
				reason: 'sender power level is less than kick level',
				rejectedBy: powerLevelEvent.toEventBase(),
			});
		}

		case 'ban': {
			// If the sender’s current membership state is not join, reject.
			if (senderMembership !== 'join') {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: membershipEventToCheck,
					reason: 'sender is not join',
					rejectedBy: senderMembershipEvent,
				});
			}

			// If the sender’s power level is greater than or equal to the ban level, and the target user’s power level is less than the sender’s power level, allow.
			const senderPowerLevel = powerLevelEvent.getPowerLevelForUser(
				sender,
				roomCreateEvent,
			);
			// defaults to 50 if not specified
			const banLevel = powerLevelEvent.getRequiredPowerForBan();
			if (
				senderPowerLevel >= banLevel &&
				powerLevelEvent.getPowerLevelForUser(invitee, roomCreateEvent) <
					senderPowerLevel
			) {
				return;
			}

			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: membershipEventToCheck,
				reason: 'sender power level is less than ban level',
				rejectedBy: powerLevelEvent.toEventBase(),
			});
		}

		default:
			// unknown
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: membershipEventToCheck,
				reason: `unknown membership state ${content.membership}`,
			});
	}
}

export function validatePowerLevelEvent(
	powerLevelEvent: PowerLevelEvent,
	roomCreateEvent: PersistentEventBase<RoomVersion, 'm.room.create'>,
	authEventMap: Map<StateMapKey, PersistentEventBase>,
) {
	// If the users property in content is not an object with keys that are valid user IDs with values that are integers (or a string that is an integer), reject.
	// If there is no previous m.room.power_levels event in the room, allow.
	const existinPowerLevelEvent = getStateByMapKey(authEventMap, {
		type: 'm.room.power_levels',
	});
	if (!existinPowerLevelEvent?.isPowerLevelEvent()) {
		// allow if no previous power level event
		return;
	}

	const existingPowerLevel = PowerLevelEvent.fromEvent(existinPowerLevelEvent);

	const newPowerLevel = powerLevelEvent;

	const senderCurrentPowerLevel = existingPowerLevel.getPowerLevelForUser(
		newPowerLevel.sender,
		roomCreateEvent,
	);

	const existingUserDefaultPowerLevel =
		existingPowerLevel.getPowerLevelUserDefaultValue();

	const newUserDefaultPowerLevel =
		newPowerLevel.getPowerLevelUserDefaultValue();

	// For each found alteration:

	// If the current value is greater than the sender’s current power level, reject.
	// If the new value is greater than the sender’s current power level, reject.

	if (existingUserDefaultPowerLevel !== newUserDefaultPowerLevel) {
		if (
			newUserDefaultPowerLevel &&
			newUserDefaultPowerLevel > senderCurrentPowerLevel
		) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason:
					'new user_default power level is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}

		if (
			existingUserDefaultPowerLevel &&
			existingUserDefaultPowerLevel > senderCurrentPowerLevel
		) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason:
					'existing user_default power level is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}
	}

	const newEventsDefaultValue = newPowerLevel.getPowerLevelEventsDefaultValue();
	const existingEventsDefaultValue =
		existingPowerLevel.getPowerLevelEventsDefaultValue();

	if (existingEventsDefaultValue !== newEventsDefaultValue) {
		if (
			newEventsDefaultValue &&
			newEventsDefaultValue > senderCurrentPowerLevel
		) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason:
					'new events_default power level is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}

		if (
			existingEventsDefaultValue &&
			existingEventsDefaultValue > senderCurrentPowerLevel
		) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason:
					'existing events_default power level is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}
	}

	const newStateDefaultValue = newPowerLevel.getPowerLevelStateDefaultValue();
	const existingStateDefaultValue =
		existingPowerLevel.getPowerLevelStateDefaultValue();

	if (existingStateDefaultValue !== newStateDefaultValue) {
		if (
			newStateDefaultValue &&
			newStateDefaultValue > senderCurrentPowerLevel
		) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason:
					'new state_default power level is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}

		if (
			existingStateDefaultValue &&
			existingStateDefaultValue > senderCurrentPowerLevel
		) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason:
					'existing state_default power level is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}
	}

	const newBanValue = newPowerLevel.getPowerLevelBanValue();
	const existingBanValue = existingPowerLevel.getPowerLevelBanValue();

	// for ban
	if (existingBanValue !== newBanValue) {
		if (newBanValue && newBanValue > senderCurrentPowerLevel) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason: 'new power level value is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}

		if (existingBanValue && existingBanValue > senderCurrentPowerLevel) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason: 'existing power level value is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}
	}

	const newKickValue = newPowerLevel.getPowerLevelKickValue();
	const existingKickValue = existingPowerLevel.getPowerLevelKickValue();

	// for kick
	if (existingKickValue !== newKickValue) {
		if (newKickValue && newKickValue > senderCurrentPowerLevel) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason: 'new power level value is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}

		if (existingKickValue && existingKickValue > senderCurrentPowerLevel) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason: 'existing power level value is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}
	}

	// for redact
	const newRedactValue = newPowerLevel.getPowerLevelRedactValue();
	const existingRedactValue = existingPowerLevel.getPowerLevelRedactValue();

	if (existingRedactValue !== newRedactValue) {
		if (newRedactValue && newRedactValue > senderCurrentPowerLevel) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason: 'new power level value is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}

		if (existingRedactValue && existingRedactValue > senderCurrentPowerLevel) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason: 'existing power level value is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}
	}

	// for invite
	const newInviteValue = newPowerLevel.getPowerLevelInviteValue();
	const existingInviteValue = existingPowerLevel.getPowerLevelInviteValue();

	if (existingInviteValue !== newInviteValue) {
		if (newInviteValue && newInviteValue > senderCurrentPowerLevel) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason: 'new power level value is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}

		if (existingInviteValue && existingInviteValue > senderCurrentPowerLevel) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: powerLevelEvent.toEventBase()!,
				reason: 'existing power level value is greater than sender power level',
				rejectedBy: existingPowerLevel.toEventBase(),
			});
		}
	}

	const existingContent = existingPowerLevel.toEventBase()?.getContent();
	const newContent = newPowerLevel.toEventBase()?.getContent();

	// 4. For each entry being changed in, or removed from, the events property:
	const existingEvents = Object.keys(existingContent?.events ?? {});
	for (const eventType of existingEvents) {
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
				existingPowerLevelValue > senderCurrentPowerLevel
			) {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: powerLevelEvent.toEventBase()!,
					reason:
						'existing power level value is greater than sender power level',
					rejectedBy: existingPowerLevel.toEventBase(),
				});
			}
		}
	}

	// 5. For each entry being added to, or changed in, the events property:
	const newEvents = Object.keys(newContent?.events ?? {});
	for (const eventType of newEvents) {
		const existingPowerLevelValue = existingPowerLevel.getPowerLevelEventsValue(
			eventType as PduType,
		);
		const newPowerLevelValue = newPowerLevel.getPowerLevelEventsValue(
			eventType as PduType,
		);
		if (!newPowerLevelValue || newPowerLevelValue !== existingPowerLevelValue) {
			// changed or added
			// If the new value is greater than the sender’s current power level, reject.
			if (newPowerLevelValue && newPowerLevelValue > senderCurrentPowerLevel) {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: powerLevelEvent.toEventBase()!,
					reason: 'new power level value is greater than sender power level',
					rejectedBy: existingPowerLevel.toEventBase(),
				});
			}
		}
	}

	// 6. For each entry being changed in, or removed from, the users property, other than the sender’s own entry:
	const existingUsers = Object.keys(existingContent?.users ?? {});

	for (const userId of existingUsers) {
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
				existingPowerLevelValue > senderCurrentPowerLevel
			) {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: powerLevelEvent.toEventBase()!,
					reason:
						'existing power level value is greater than sender power level',
					rejectedBy: existingPowerLevel.toEventBase(),
				});
			}
		}
	}

	// 7. For each entry being changed in, or removed from, the users property:
	const newUsers = Object.keys(newContent?.users ?? {});
	for (const userId of newUsers) {
		const existingPowerLevelValue =
			existingPowerLevel.getPowerLevelUsersValue(userId);
		const newPowerLevelValue = newPowerLevel.getPowerLevelUsersValue(userId);
		if (
			!existingPowerLevelValue ||
			newPowerLevelValue !== existingPowerLevelValue
		) {
			// changed or added
			// If the new value is greater than the sender’s current power level, reject.
			if (newPowerLevelValue && newPowerLevelValue > senderCurrentPowerLevel) {
				throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
					rejectedEvent: powerLevelEvent.toEventBase()!,
					reason: 'new power level value is greater than sender power level',
					rejectedBy: existingPowerLevel.toEventBase(),
				});
			}
		}
	}
}

export function checkEventAuthWithoutState(
	event: PersistentEventBase,
	authEvents: PersistentEventBase[],
) {
	if (event.isCreateEvent()) {
		if (authEvents.length > 0) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: event,
				reason: 'm.room.create event has auth_events',
			});
		}

		return isCreateAllowed(event);
	}

	/*
	 * Considering the event’s auth_events:

	* 	If there are duplicate entries for a given type and state_key pair, reject.
	* 	If there are entries whose type and state_key don’t match those specified by the auth events selection algorithm described in the server specification, reject.
	* 	If there are entries which were themselves rejected under the checks performed on receipt of a PDU, reject.
	* 	If there is no m.room.create event among the entries, reject.

	*/

	const stateKeysNeeded = new Map<StateMapKey, null>(
		event.getAuthEventStateKeys().map((key) => [key, null]),
	);

	const authEventStateMap = new Map<StateMapKey, PersistentEventBase>();

	for (const authEvent of authEvents) {
		// if rejected, reject this event
		if (authEvent.isAuthRejected()) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: event,
				reason: 'auth event required to authorize this event was rejected',
				rejectedBy: authEvent,
			});
		}

		const stateKey = authEvent.getUniqueStateIdentifier();

		// if this is not neeede, throw
		if (!stateKeysNeeded.has(stateKey)) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: event,
				reason: 'excess auth event',
				rejectedBy: authEvent,
			});
		}

		if (authEventStateMap.has(stateKey)) {
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: event,
				rejectedBy: authEvent,
				reason: 'duplicate auth event',
			});
		}

		authEventStateMap.set(stateKey, authEvent);
	}

	const roomCreateEvent = getStateByMapKey(authEventStateMap, {
		type: 'm.room.create',
	});

	if (!roomCreateEvent) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: event,
			reason: 'missing m.room.create event',
		});
	}

	// return?
}

export async function checkEventAuthWithState(
	event: PersistentEventBase, // to auth
	state: Map<StateMapKey, PersistentEventBase>, // to auth against, should have all the auth events and resolved ones from state
	store: EventStore,
): Promise<void> {
	if (event.isCreateEvent()) {
		// should be validated already by checkEventAuthWithoutState
		return;
	}

	const roomCreateEvent = getStateByMapKey(state, {
		type: 'm.room.create',
	});

	assert(roomCreateEvent, 'missing m.room.create event');

	if (!roomCreateEvent.isCreateEvent()) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: event,
			reason: 'm.room.create event not found',
		});
	}

	// If the content of the m.room.create event in the room state has the property m.federate set to false, and the sender domain of the event does not match the sender domain of the create event, reject.
	if (
		roomCreateEvent.getContent()['m.federate'] === false &&
		event.origin !== roomCreateEvent.origin
	) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: event,
			rejectedBy: roomCreateEvent,
			reason: 'm.federate is false and sender domain does not match',
		});
	}

	if (event.isAliasEvent()) {
		return isRoomAliasAllowed(event);
	}

	if (event.isMembershipEvent()) {
		return isMembershipChangeAllowed(event, state, store);
	}

	// If the sender’s current membership state is not join, reject.
	const senderMembership = getStateByMapKey(state, {
		type: 'm.room.member',
		state_key: event.sender,
	});
	if (senderMembership?.getMembership() !== 'join') {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: event,
			reason: "sender's membership is not join",
			rejectedBy: senderMembership,
		});
	}

	// If type is m.room.third_party_invite:
	// @ts-ignore the pdu union doesn't have this type TODO: add
	if (event.type === 'm.room.third_party_invite') {
		console.warn('third_party_invite not implemented');
		throw new StateResolverAuthorizationError(RejectCodes.NotImplemented, {
			rejectedEvent: event,
			reason: 'third_party_invite not implemented',
		});
	}

	const existingPowerLevelEvent = getStateByMapKey(state, {
		type: 'm.room.power_levels',
	});

	const powerLevelEvent = existingPowerLevelEvent?.isPowerLevelEvent()
		? PowerLevelEvent.fromEvent(existingPowerLevelEvent)
		: PowerLevelEvent.fromDefault();

	// If the event type’s required power level is greater than the sender’s power level, reject.
	const eventRequiredPowerLevel =
		powerLevelEvent.getRequiredPowerLevelForEvent(event);

	const userPowerLevel = powerLevelEvent.getPowerLevelForUser(
		event.sender,
		roomCreateEvent,
	);

	if (userPowerLevel < eventRequiredPowerLevel) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: event,
			rejectedBy: powerLevelEvent.toEventBase(),
			reason: `user power level ${userPowerLevel} is less than event required power level ${eventRequiredPowerLevel}`,
		});
	}

	// If the event has a state_key that starts with an @ and does not match the sender, reject.
	if (event.stateKey?.startsWith('@') && event.stateKey !== event.sender) {
		throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
			rejectedEvent: event,
			reason: 'event state_key does not match sender',
		});
	}

	// If type is m.room.power_levels:
	if (event.isPowerLevelEvent()) {
		return validatePowerLevelEvent(
			event.toPowerLevelEvent(),
			roomCreateEvent,
			state,
		);
	}

	// TODO: redaction

	// 12. otherwise allow
}
