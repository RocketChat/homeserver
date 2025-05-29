// RoomManager is to create partitions among different versions
// of rooms and applicable methods.

import {
	PduV1Schema,
	type PduCanonicalAliasEventContent,
	type PduCreateEventContent,
	type PduJoinRuleEventContent,
	type PduMembershipEventContent,
	type PduPowerLevelsEventContent,
	type PduV1,
	isCreateEvent,
	isMembershipEvent,
	isPowerLevelsEvent,
	isJoinRuleEvent,
	isCanonicalAliasEvent,
} from "../types/v1";

import type { PduV3 } from "../types/v3";

export interface IRoomManager {
	// START: event validation
	// throw error
	// TODO: custom error for this
	validateEvent(event: PduV1 | PduV3): Promise<PduV1 | PduV3>;

	// mostly typecheckers
	isCreateEvent(
		event: PduV1 | PduV3,
	): event is (PduV1 | PduV3) & PduCreateEventContent;

	isMembershipEvent(
		event: PduV1 | PduV3,
	): event is (PduV1 | PduV3) & PduMembershipEventContent;

	isPowerLevelsEvent(
		event: PduV1 | PduV3,
	): event is (PduV1 | PduV3) & PduPowerLevelsEventContent;

	isJoinRuleEvent(
		event: PduV1 | PduV3,
	): event is (PduV1 | PduV3) & PduJoinRuleEventContent;

	isCanonicalAliasEvent(
		event: PduV1 | PduV3,
	): event is (PduV1 | PduV3) & PduCanonicalAliasEventContent;

	// END: event validation

	// START: state resolution

	resolveState<T extends PduV1 | PduV3>(stateEvents: T[]): T[];

	// END: state resolution

	// START: authorization
	isEventAllowed<T extends PduV1 | PduV3>(event: T, state: T[]): boolean;

	// END: authorization
}

/*
 * Things that depend on room version are,
 * 1. schemas
 * 2. authorization rules
 * 3. state resolution algorithms
 */
export class RoomManager {
	constructor(private readonly createEventContent: PduCreateEventContent) {}
}

export class RoomV1Manager implements IRoomManager {
	async validateEvent(event: PduV1): Promise<PduV1> {
		return (await PduV1Schema.parseAsync(event)) as PduV1;
	}

	isCreateEvent(event: PduV1): event is PduV1 & PduCreateEventContent {
		return isCreateEvent(event);
	}

	isMembershipEvent(event: PduV1): event is PduV1 & PduMembershipEventContent {
		return isMembershipEvent(event);
	}

	isPowerLevelsEvent(
		event: PduV1,
	): event is PduV1 & PduPowerLevelsEventContent {
		return isPowerLevelsEvent(event);
	}

	isJoinRuleEvent(event: PduV1): event is PduV1 & PduJoinRuleEventContent {
		return isJoinRuleEvent(event);
	}

	isCanonicalAliasEvent(
		event: PduV1,
	): event is PduV1 & PduCanonicalAliasEventContent {
		return isCanonicalAliasEvent(event);
	}

	resolveState<T extends PduV1 | PduV3>(stateEvents: T[]): T[] {
		throw new Error("state resolution not implemented for v1");
	}

	isEventAllowed<T extends PduV1 | PduV3>(event: T, state: T[]): boolean {
		throw new Error("Method not implemented.");
	}
}
