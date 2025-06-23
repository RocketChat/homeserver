import {
	PduTypeRoomCreate,
	type PduCreateEventContent,
	type PduV1,
} from '../types/v1';
import type { PduV3 } from '../types/v3';
import type { PduV10 } from '../types/v10';

import { PersistentEventV1 } from './v1';
import { PersistentEventV3 } from './v3';
import { PersistentEventV10 } from './v10';

import type {
	PduVersionForRoomVersionWithOnlyRequiredFields,
	RoomVersion,
} from './type';
import type { PersistentEventBase } from './event-wrapper';

function isV1ToV2(_event: unknown, roomVersion: RoomVersion): _event is PduV1 {
	return roomVersion === '1' || roomVersion === '2';
}

function isV3To9(_event: unknown, roomVersion: RoomVersion): _event is PduV3 {
	return (
		roomVersion === '3' ||
		roomVersion === '4' ||
		roomVersion === '5' ||
		roomVersion === '6' ||
		roomVersion === '7' ||
		roomVersion === '8' ||
		roomVersion === '9'
	);
}

function isV10To11(
	_event: unknown,
	roomVersion: RoomVersion,
): _event is PduV10 {
	return roomVersion === '10' || roomVersion === '11';
}

// Utility function to create a random ID for room creation
function createRoomIdPrefix(length: number) {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
	let result = '';
	for (let i = 0; i < length; i++) {
		const randomIndex = Math.floor(Math.random() * characters.length);
		result += characters[randomIndex];
	}
	return result;
}

// The idea is to ALWAYS use this to create different events
export class PersistentEventFactory {
	static createFromRawEvent(
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

	// create individual events

	// a m.room.create event, adds the roomId too
	newCreateEvent(creator: string, roomVersion: RoomVersion) {
		if (roomVersion !== '11') {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const createContent: PduCreateEventContent = {
			room_version: roomVersion,
			creator,
			'm.federate': true,
		};

		const domain = creator.split(':').pop();

		const roomId = `${createRoomIdPrefix(8)}:${domain}`;

		const eventPartial: PduVersionForRoomVersionWithOnlyRequiredFields<'11'> = {
			type: PduTypeRoomCreate,
			content: createContent,
			sender: creator,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		// FIXME: typing
		return new PersistentEventV10(eventPartial as any);
	}
}
