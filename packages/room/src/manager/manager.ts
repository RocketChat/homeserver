// RoomManager is to create partitions among different versions
// of rooms and applicable methods.

import {
	type PduCanonicalAliasEventContent,
	type PduCreateEventContent,
	type PduJoinRuleEventContent,
	type PduMembershipEventContent,
	type PduPowerLevelsEventContent,
	type PduV1,
} from "../types/v1";

import type { PduV3 } from "../types/v3";

import { RoomV1Validator } from "./v1";

export interface IRoomValidator {
	// START: event validation
	// throw error
	// TODO: custom error for this
	parseEvent(event: PduV1 | PduV3): Promise<PduV1 | PduV3>;

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
}

export interface IRoomAuthorizer {
	isEventAllowed(event: PduV1 | PduV3, state: PduV1[]): boolean;
}

/*
 * Things that depend on room version are,
 * 1. schemas
 * 2. authorization rules
 * 3. state resolution algorithms
 */
export class RoomManagerFactory {
	static createValidator(version: number): IRoomValidator {
		if (version === 1) {
			return new RoomV1Validator();
		}

		throw new Error(`Unsupported room version: ${version}`);
	}
}
