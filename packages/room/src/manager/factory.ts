import type { PduWithHashesAndSignaturesOptional, PersistentEventBase, RedactionEventFields } from './event-wrapper';
import type { RoomVersion, RoomVersion3To11 } from './type';
import { PersistentEventV11 } from './v11';
import { PersistentEventV3 } from './v3';
import { PersistentEventV6 } from './v6';
import { PersistentEventV8 } from './v8';
import { PersistentEventV9 } from './v9';
import { RoomID, roomIdSchema } from '../types/_common';
import type { EventID, PduForType, UserID } from '../types/_common';
import type { Pdu, PduType, PduCreateEventContent, PduRoomRedactionContent } from '../types/v3-11';

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

// what the factory needs from a room version implementation: build events of that
// version, and know how that version shapes the content of a new create event
type PersistentEventClass = (new (
	event: PduWithHashesAndSignaturesOptional,
	roomVersion: RoomVersion3To11,
	partial?: boolean,
) => PersistentEventBase<RoomVersion3To11, PduType>) & {
	newCreateEventContent(creator: UserID, roomVersion: RoomVersion): PduCreateEventContent;
	newRedactionEventFields(redacts: EventID, content: PduRoomRedactionContent): RedactionEventFields;
};

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

	static defaultRoomVersion = '11' as const;

	static isSupportedRoomVersion(roomVersion: string): roomVersion is RoomVersion3To11 {
		return PersistentEventFactory.supportedRoomVersions.includes(roomVersion);
	}

	// the single place mapping a room version to the class implementing its rules
	private static getEventClass(roomVersion: string): PersistentEventClass {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		switch (roomVersion) {
			case '3':
			case '4':
			case '5':
				return PersistentEventV3;
			case '6':
			case '7':
				return PersistentEventV6;
			case '8':
				return PersistentEventV8;
			case '9':
			case '10':
				return PersistentEventV9;
			case '11':
				return PersistentEventV11;
			default:
				throw new Error(`Unknown room version: ${roomVersion}`);
		}
	}

	static createFromRawEvent<Type extends PduType>(
		event: PduWithHashesAndSignaturesOptional,
		roomVersion: string,
		partial = false,
	): PersistentEventBase<RoomVersion, Type> {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const EventClass = PersistentEventFactory.getEventClass(roomVersion);

		return new EventClass(event, roomVersion, partial) as PersistentEventBase<RoomVersion, Type>;
	}

	// create individual events

	// a m.room.create event, adds the roomId too
	static newCreateEvent(creator: UserID, roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion) {
		const createContent = PersistentEventFactory.getEventClass(roomVersion).newCreateEventContent(creator, roomVersion);

		const domain = creator.split(':').pop();

		const roomId = roomIdSchema.parse(`!${createRoomIdPrefix(8)}:${domain}`);

		const eventPartial: PartialEvent<PduForType<'m.room.create'>> = {
			type: 'm.room.create',
			state_key: '',
			content: createContent,
			sender: creator,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 1,
		};

		return PersistentEventFactory.createFromRawEvent<'m.room.create'>(eventPartial, roomVersion);
	}

	// the target of a redaction is a top level field before v11 and part of content from v11 on
	static newRedactionEventFields(redacts: EventID, content: PduRoomRedactionContent, roomVersion: RoomVersion): RedactionEventFields {
		return PersistentEventFactory.getEventClass(roomVersion).newRedactionEventFields(redacts, content);
	}

	static newEvent<Type extends PduType>(
		event: PduWithHashesAndSignaturesOptional<PduForType<Type>>,
		roomVersion: RoomVersion,
	): PersistentEventBase<RoomVersion, Type> {
		return PersistentEventFactory.createFromRawEvent(event, roomVersion);
	}
}
