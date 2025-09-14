import {
	Pdu,
	type PduCreateEventContent,
	type PduJoinRuleEventContent,
	type PduMembershipEventContent,
	PduPowerLevelsEventContent,
	PduType,
} from '../types/v3-11';

import { PersistentEventV3 } from './v3';

import { PduForType } from '../types/_common';
import type {
	PduWithHashesAndSignaturesOptional,
	PersistentEventBase,
} from './event-wrapper';
import type { RoomVersion } from './type';
import { PersistentEventV6 } from './v6';
import { PersistentEventV8 } from './v8';
import { PersistentEventV9 } from './v9';
import { PersistentEventV11 } from './v11';

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

type PartialEvent<T extends Pdu = Pdu> = Omit<T, 'signatures' | 'hashes'>;

// The idea is to ALWAYS use this to create different events
export class PersistentEventFactory {
	static supportedRoomVersions = [
		// '1',
		// '2',
		'3',
		'4',
		'5',
		'6',
		'7',
		'8',
		'9',
		'10',
		'11',
	];

	static defaultRoomVersion = '10' as const; // same as synapse

	static isSupportedRoomVersion(
		roomVersion: string,
	): roomVersion is RoomVersion {
		return PersistentEventFactory.supportedRoomVersions.includes(roomVersion);
	}

	static createFromRawEvent<Type extends PduType>(
		event: PduWithHashesAndSignaturesOptional,
		roomVersion: RoomVersion,
	): PersistentEventBase<RoomVersion, Type> {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		switch (roomVersion) {
			case '3':
			case '4':
			case '5':
				return new PersistentEventV3(event) as PersistentEventBase<
					RoomVersion,
					Type
				>;
			case '6':
			case '7':
				return new PersistentEventV6(event) as PersistentEventBase<
					RoomVersion,
					Type
				>;
			case '8':
				return new PersistentEventV8(event) as PersistentEventBase<
					RoomVersion,
					Type
				>;
			case '9':
			case '10':
				return new PersistentEventV9(event) as PersistentEventBase<
					RoomVersion,
					Type
				>;
			case '11':
				return new PersistentEventV11(event) as PersistentEventBase<
					RoomVersion,
					Type
				>;
			default:
				throw new Error(`Unknown room version: ${roomVersion}`);
		}
	}

	// create individual events

	// a m.room.create event, adds the roomId too
	static newCreateEvent(creator: string, roomVersion: RoomVersion) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const createContent: PduCreateEventContent = {
			room_version: roomVersion,
			creator,
		};

		const domain = creator.split(':').pop();

		const roomId = `!${createRoomIdPrefix(8)}:${domain}`;

		const eventPartial: PartialEvent<PduForType<'m.room.create'>> = {
			type: 'm.room.create',
			state_key: '',
			content: createContent,
			sender: creator,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent<'m.room.create'>(
			eventPartial,
			roomVersion,
		);
	}

	static newEvent<Type extends PduType>(
		event: PduWithHashesAndSignaturesOptional<PduForType<Type>>,
		roomVersion: RoomVersion,
	): PersistentEventBase<RoomVersion, Type> {
		return PersistentEventFactory.createFromRawEvent(event, roomVersion);
	}
}
