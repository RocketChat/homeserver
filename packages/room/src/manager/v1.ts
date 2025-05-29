import {
	type PduV1,
	type PduCreateEvent,
	type PduMembershipEvent,
	type PduPowerLevelsEvent,
	type PduJoinRuleEvent,
	type PduCanonicalAliasEvent,
	PduV1Schema,
} from "../types/v1";
import type { IRoomValidator } from "./manager";

export class _RoomV1Validator implements IRoomValidator {
	isCreateEvent(event: PduV1): event is PduCreateEvent {
		throw new Error("Method not implemented.");
	}

	isMembershipEvent(event: PduV1): event is PduMembershipEvent {
		throw new Error("Method not implemented.");
	}

	isPowerLevelsEvent(event: PduV1): event is PduPowerLevelsEvent {
		throw new Error("Method not implemented.");
	}

	isJoinRuleEvent(event: PduV1): event is PduJoinRuleEvent {
		throw new Error("Method not implemented.");
	}

	isCanonicalAliasEvent(event: PduV1): event is PduCanonicalAliasEvent {
		throw new Error("Method not implemented.");
	}

	parseEvent(event: PduV1): Promise<PduV1> {
		return PduV1Schema.parseAsync(event);
	}
}

export const RoomV1Validator = new _RoomV1Validator();
