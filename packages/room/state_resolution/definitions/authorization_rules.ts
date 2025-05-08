import {
  getPowerLevel,
  isCreateEvent,
  isMembershipEvent,
  isPowerEvent,
  PDUType,
  type PDUCreateEvent,
  type PDUJoinRuleEvent,
  type PDUMembershipEvent,
  type PDUPowerLevelsEvent,
  type StateKey,
  type V2Pdu,
} from "../../events";

import { getStateMapKey } from "./definitions";

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

function extractDomain(identifier: string): string | undefined {
  return identifier.split(":").pop();
}

function isCreateAllowed(event: V2Pdu) {
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
function isRoomAliasAllowed(event: V2Pdu) {
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

function isMembershipChangeAllowed(
  event: PDUMembershipEvent,
  authEventMap: Map<StateKey, V2Pdu>
): boolean {
  // If there is no state_key property, or no membership property in content, reject.
  if (!event.state_key || !event.content.membership) {
    return false;
  }

  // sender -> who asked for the change
  // state_key -> whose state is asked to change

  // sender information, like does this user have permission?
  const sender = event.sender;
  const senderMembership = authEventMap.get(
    getStateMapKey({ type: PDUType.Member, state_key: sender })
  ) as PDUMembershipEvent;

  // user to be invited
  const invitee = event.state_key;
  const inviteeMembership = authEventMap.get(
    getStateMapKey({ type: PDUType.Member, state_key: invitee })
  ) as PDUMembershipEvent;

  //   const roomEvent = authEventMap.get(getStateMapKey({ type: PDUType.Create })) as PDUCreateEvent;
  //   const room = {
  // 	  join_rules: roomEvent?.content.join_rules,
  //   } as const;
  const joinRuleEvent = authEventMap.get(
    getStateMapKey({ type: PDUType.JoinRules })
  ) as PDUJoinRuleEvent;
  const joinRule = joinRuleEvent?.content.join_rule;

  const roomCreateEvent = authEventMap.get(
    getStateMapKey({ type: PDUType.Create })
  ) as PDUCreateEvent;

  const powerLevelEvent = getPowerLevel(
    authEventMap.get(
      getStateMapKey({ type: PDUType.PowerLevels })
    ) as PDUPowerLevelsEvent
  );

  const getPowerLevelForUser = (userId: string) => {
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
    if (roomCreateEvent.content.creator === userId) {
      return 100;
    }

    return 0;
  };

  switch (event.content.membership) {
    case "join": {
      if (senderMembership.content.membership === "join") {
        return true; // ?
      }

      // If the only previous event is an m.room.create and the state_key is the creator, allow.
      if (event.prev_events.length === 1) {
        const prevEvent = authEventMap.get(event.prev_events[0]);

        return prevEvent
          ? isCreateEvent(prevEvent) && prevEvent.state_key === event.state_key
          : false;
      }

      // If the sender does not match state_key, reject.
      if (sender !== invitee) {
        return false;
      }

      // If the sender is banned, reject.
      if (senderMembership.content.membership === "ban") {
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
      if (senderMembership.content.membership !== "join") {
        return false;
      }

      // If target user’s current membership state is join or ban, reject.
      if (
        inviteeMembership.content.membership === "join" ||
        inviteeMembership.content.membership === "ban"
      ) {
        return false;
      }

      // If the sender’s power level is greater than or equal to the invite level, allow.
      const senderPowerLevel = getPowerLevelForUser(sender);
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
        (inviteeMembership.content.membership === "invite" ||
          inviteeMembership.content.membership === "join")
      ) {
        return true;
      }

      // If the sender’s current membership state is not join, reject.
      if (senderMembership.content.membership !== "join") {
        return false;
      }

      // If the target user’s current membership state is ban, and the sender’s power level is less than the ban level, reject.
      const senderPowerLevel = getPowerLevelForUser(sender);
      // defaults to 50 if not specified
      const banLevel = powerLevelEvent?.content.ban ?? 50;
      if (
        inviteeMembership.content.membership === "ban" &&
        senderPowerLevel < banLevel
      ) {
        return false;
      }

      // If the sender’s power level is greater than or equal to the kick level, and the target user’s power level is less than the sender’s power level, allow.
      const kickRequiredLevel = powerLevelEvent?.content.kick ?? 50;
      if (
        senderPowerLevel >= kickRequiredLevel &&
        getPowerLevelForUser(invitee) < senderPowerLevel
      ) {
        return true;
      }

      return false;
    }

    case "ban": {
      // If the sender’s current membership state is not join, reject.
      if (senderMembership.content.membership !== "join") {
        return false;
      }

      // If the sender’s power level is greater than or equal to the ban level, and the target user’s power level is less than the sender’s power level, allow.
      const senderPowerLevel = getPowerLevelForUser(sender);
      // defaults to 50 if not specified
      const banLevel = powerLevelEvent?.content.ban ?? 50;
      if (
        senderPowerLevel >= banLevel &&
        getPowerLevelForUser(invitee) < senderPowerLevel
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

function validatePowerLevelEvent(event: PDUPowerLevelsEvent) {
  // TODO: not much here
}

// autheventmap as described here https://spec.matrix.org/v1.12/server-server-api/#auth-events-selection
// could call it a sub-state, which is why using the same type as State
export function isAllowedEvent(
  event: V2Pdu,
  authEventMap: Map<StateKey, V2Pdu>
): boolean {
  if (isCreateEvent(event)) {
    return isCreateAllowed(event);
  }

  if (event.type === PDUType.Aliases) {
    return isRoomAliasAllowed(event);
  }

  if (isMembershipEvent(event)) {
    return isMembershipChangeAllowed(event, authEventMap);
  }

  // If the sender’s current membership state is not join, reject.
  const senderMembership = authEventMap.get(
    getStateMapKey({ type: PDUType.Member, state_key: event.sender })
  ) as PDUMembershipEvent;
  if (senderMembership.content.membership !== "join") {
    return false;
  }

  // If type is m.room.third_party_invite:
  if (event.type === PDUType.ThirdPartyInvite) {
    console.warn("third_party_invite not implemented");
    return false;
  }

  // If the event type’s required power level is greater than the sender’s power level, reject.
  // TODO:

  // If the event has a state_key that starts with an @ and does not match the sender, reject.
  if (event.state_key?.startsWith("@") && event.state_key !== event.sender) {
    return false;
  }

  // If type is m.room.power_levels:
  if (isPowerEvent(event)) {
    validatePowerLevelEvent(event);
    return true;
  }

  // TODO: redaction

  // 12. otherwise allow
  return true;
}
