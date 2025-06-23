import type { PduV1 } from "../types/v1";
import type { PduV3 } from "../types/v3";
import type { PduV10 } from "../types/v10";

import { PersistentEventV1 } from "./v1";
import { PersistentEventV3 } from "./v3";
import { PersistentEventV10 } from "./v10";

import type { RoomVersion } from "./type";
import type { PersistentEventBase } from "./event-manager";

function isV1ToV2(_event: unknown, roomVersion: RoomVersion): _event is PduV1 {
	return roomVersion === 1 || roomVersion === 2;
}

function isV3To9(_event: unknown, roomVersion: RoomVersion): _event is PduV3 {
	return (
		roomVersion === 3 ||
		roomVersion === 4 ||
		roomVersion === 5 ||
		roomVersion === 6 ||
		roomVersion === 7 ||
		roomVersion === 8 ||
		roomVersion === 9
	);
}

function isV10To11(
	_event: unknown,
	roomVersion: RoomVersion,
): _event is PduV10 {
	return roomVersion === 10 || roomVersion === 11;
}

export class PersistentEventFactory {
	static create(
		event: PduV1 | PduV3 | PduV10,
		roomVersion: RoomVersion,
	): PersistentEventBase<RoomVersion> {
		if (isV1ToV2(event, roomVersion)) {
			return new PersistentEventV1(event);
		}

		if (isV3To9(event, roomVersion)) {
			return new PersistentEventV3(event);
		}

		if (isV10To11(event, roomVersion)) {
			return new PersistentEventV10(event);
		}

		throw new Error(`Unknown room version: ${roomVersion}`);
	}
}
