import {
	getPduPowerLevelsEventContentSchema,
	PduTypeRoomCreate,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomCanonicalAlias,
	PduTypeRoomPowerLevels,
	PduV1Schema,
	type PduCreateEventContent,
	type PduJoinRuleEventContent,
	type PduMembershipEventContent,
	type PduCanonicalAliasEventContent,
} from "./v1";

import { z } from "zod";

// SPEC: https://spec.matrix.org/v1.12/rooms/v3/#event-format
// 1. When events are sent over federation, the event_id field is no longer included. A server receiving an event should compute the relevant event ID for itself.
// 2. Additionally, the format of the auth_events and prev_events fields are changed: instead of lists of (event_id, hash) pairs, they are now plain lists of event IDs.

export const PduV3Schema = PduV1Schema.extend({
	auth_events: z
		.array(z.string())
		.describe(
			"A list of event IDs that are required in the room state before this event can be applied. The server will not send this event if it is not satisfied.",
		),
	prev_events: z
		.array(z.string())
		.describe(
			"A list of event IDs that are required in the room state before this event can be applied. The server will not send this event if it is not satisfied.",
		),
});

export type PduV3 = z.infer<typeof PduV3Schema>;

// same as v1 but values can be both strings and numbers
// https://spec.matrix.org/v1.12/rooms/v3/#mroompower_levels-events-accept-values-as-strings
export const PduPowerLevelsEventV3ContentSchema =
	getPduPowerLevelsEventContentSchema<
		ReturnType<typeof z.number> | ReturnType<typeof z.string>
	>(3);

export type PduPowerLevelsEventV3Content = z.infer<
	typeof PduPowerLevelsEventV3ContentSchema
>;

export type PduPowerLevelsEventV3 = PduV3 & PduPowerLevelsEventV3Content;

export function isPowerLevelsEvent(
	event: PduV3,
): event is PduPowerLevelsEventV3 {
	return event.type === PduTypeRoomPowerLevels && event.state_key === "";
}

export type PduCreateEventV3 = PduV3 & PduCreateEventContent;

export function isCreateEvent(event: PduV3): event is PduCreateEventV3 {
	return event.type === PduTypeRoomCreate && event.state_key === "";
}

export type PduJoinRuleEventV3 = PduV3 & PduJoinRuleEventContent;

export function isJoinRuleEvent(event: PduV3): event is PduJoinRuleEventV3 {
	return event.type === PduTypeRoomJoinRules && event.state_key === "";
}

export type PduMembershipEventV3 = PduV3 & PduMembershipEventContent;

export function isMembershipEvent(event: PduV3): event is PduMembershipEventV3 {
	return event.type === PduTypeRoomMember && event.state_key === "";
}

export type PduCanonicalAliasEventV3 = PduV3 & PduCanonicalAliasEventContent;

export function isCanonicalAliasEvent(
	event: PduV3,
): event is PduCanonicalAliasEventV3 {
	return event.type === PduTypeRoomCanonicalAlias && event.state_key === "";
}
