import crypto from 'node:crypto';

import type { PduWithHashesAndSignaturesOptional, PersistentEventBase, RedactionEventFields } from './event-wrapper';
import { SUPPORTED_ROOM_VERSIONS } from './type';
import type { RoomVersion, RoomVersionCapabilities, SupportedRoomVersion } from './type';
import { PersistentEventV11 } from './v11';
import { PersistentEventV12 } from './v12';
import { PersistentEventV3 } from './v3';
import { PersistentEventV6 } from './v6';
import { PersistentEventV8 } from './v8';
import { PersistentEventV9 } from './v9';
import { roomIdSchema } from '../types/_common';
import type { EventID, PduForType, UserID } from '../types/_common';
import type { Pdu, PduType, PduCreateEventContent, PduRoomRedactionContent } from '../types/v3-11';

const ROOM_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function createRoomIdPrefix(length: number) {
	let result = '';
	for (let i = 0; i < length; i++) {
		result += ROOM_ID_ALPHABET[crypto.randomInt(ROOM_ID_ALPHABET.length)];
	}
	return result;
}

type PartialEvent<T extends Pdu = Pdu> = Omit<T, 'signatures' | 'hashes'>;

// what the factory needs from a room version implementation: build events of that
// version, and know how that version shapes the content of a new create event
type PersistentEventClass = (new (
	event: PduWithHashesAndSignaturesOptional,
	roomVersion: SupportedRoomVersion,
	partial?: boolean,
) => PersistentEventBase<SupportedRoomVersion, PduType>) & {
	readonly capabilities: RoomVersionCapabilities;
	newCreateEventContent(creator: UserID, roomVersion: RoomVersion, additionalCreators?: UserID[]): PduCreateEventContent;
	newRedactionEventFields(redacts: EventID, content: PduRoomRedactionContent): RedactionEventFields;
};

export type NewCreateEventOptions = {
	// users sharing creator authority with the sender, only supported where creators are privileged (v12+)
	additionalCreators?: UserID[];
};

// The idea is to ALWAYS use this to create different events
export class PersistentEventFactory {
	static supportedRoomVersions: string[] = [...SUPPORTED_ROOM_VERSIONS];

	static isSupportedRoomVersion(roomVersion: string): roomVersion is SupportedRoomVersion {
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
			case '12':
				return PersistentEventV12;
			default:
				throw new Error(`Unknown room version: ${roomVersion}`);
		}
	}

	static getCapabilities(roomVersion: string): RoomVersionCapabilities {
		return PersistentEventFactory.getEventClass(roomVersion).capabilities;
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

	// a m.room.create event. before v12 it carries a newly generated room id, from v12 on
	// the room id is the hash of this event, readable through .roomId once it is built
	static newCreateEvent(creator: UserID, roomVersion: RoomVersion, options: NewCreateEventOptions = {}) {
		const EventClass = PersistentEventFactory.getEventClass(roomVersion);

		if (options.additionalCreators?.length && !EventClass.capabilities.privilegedCreators) {
			throw new Error(`Room version ${roomVersion} does not support additional creators`);
		}

		const createContent = EventClass.newCreateEventContent(creator, roomVersion, options.additionalCreators);

		const eventPartial: PartialEvent<PduForType<'m.room.create'>> = {
			type: 'm.room.create',
			state_key: '',
			content: createContent,
			sender: creator,
			origin_server_ts: Date.now(),
			prev_events: [],
			auth_events: [],
			depth: 1,
		};

		if (EventClass.capabilities.roomIdFormat === 'random-with-domain') {
			const domain = creator.split(':').pop();
			eventPartial.room_id = roomIdSchema.parse(`!${createRoomIdPrefix(8)}:${domain}`);
		}

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
