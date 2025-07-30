import {
	Pdu,
	type PduCreateEventContent,
	type PduJoinRuleEventContent,
	type PduMembershipEventContent,
	PduPowerLevelsEventContent,
	type PduRoomNameEventContent,
	PduTypeReaction,
	PduTypeRoomCanonicalAlias,
	PduTypeRoomCreate,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomMessage,
	PduTypeRoomName,
	PduTypeRoomPowerLevels,
	PduTypeRoomRedaction,
} from '../types/v3-11';

import { PersistentEventV3 } from './v3';

import { PduForType } from '../types/_common';
import type { PersistentEventBase } from './event-wrapper';
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

// The idea is to ALWAYS use this to create different events
export class PersistentEventFactory {
	static supportedRoomVersions = [
		'3',
		'4',
		'5',
		'6',
		'7',
		'8',
		'9',
		'10',
		'11',
	] as RoomVersion[];

	static defaultRoomVersion = '10' as const; // same as synapse

	static isSupportedRoomVersion(roomVersion: RoomVersion) {
		return PersistentEventFactory.supportedRoomVersions.includes(roomVersion);
	}

	static createFromRawEvent(
		rawEvent: Omit<Pdu, 'signatures' | 'hashes'> & {
			signatures?: Pdu['signatures'];
			hashes?: Pdu['hashes'];
		},
		roomVersion: RoomVersion,
	): PersistentEventBase<RoomVersion> {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const event = rawEvent as Pdu;

		switch (roomVersion) {
			case '3':
			case '4':
			case '5':
				return new PersistentEventV3(event, false);
			case '6':
			case '7':
				return new PersistentEventV6(event, false);
			case '8':
				return new PersistentEventV8(event, false);
			case '9':
			case '10':
				return new PersistentEventV9(event, false);
			case '11':
				return new PersistentEventV11(event, false);
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

		const eventPartial: Omit<
			PduForType<typeof PduTypeRoomCreate>,
			'signatures' | 'hashes'
		> = {
			type: PduTypeRoomCreate,
			state_key: '',
			content: createContent,
			sender: creator,
			origin_server_ts: Date.now(),
			origin: domain,
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newMembershipEvent(
		roomId: string,
		sender: string,
		userId: string,
		membership: PduMembershipEventContent['membership'],
		roomInformation: PduCreateEventContent,
	) {
		if (
			!PersistentEventFactory.isSupportedRoomVersion(
				roomInformation.room_version as RoomVersion,
			)
		) {
			throw new Error(
				`Room version ${roomInformation.room_version} is not supported`,
			);
		}

		const displayname = userId.split(':').shift()?.slice(1);

		if (!displayname) {
			throw new Error(
				'Displayname not found while trying to create a membership event',
			);
		}

		const membershipContent: PduMembershipEventContent = {
			membership,
			displayname,
		};

		const eventPartial: Omit<
			PduForType<typeof PduTypeRoomMember>,
			'signatures' | 'hashes'
		> = {
			type: PduTypeRoomMember,
			content: membershipContent,
			sender: sender,
			origin: sender.split(':').pop(),
			origin_server_ts: Date.now(),
			room_id: roomId,
			state_key: userId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(
			eventPartial,
			roomInformation.room_version as RoomVersion,
		);
	}

	static newPowerLevelEvent(
		roomId: string,
		sender: string,
		content: PduPowerLevelsEventContent,
		roomVersion: RoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: Omit<
			PduForType<typeof PduTypeRoomPowerLevels>,
			'signatures' | 'hashes'
		> = {
			type: PduTypeRoomPowerLevels,
			content: content,
			sender: sender,
			origin_server_ts: Date.now(),
			origin: sender.split(':').pop(),
			room_id: roomId,
			state_key: '',
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newRoomNameEvent(
		roomId: string,
		sender: string,
		name: string,
		roomVersion: RoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: Omit<
			PduForType<typeof PduTypeRoomName>,
			'signatures' | 'hashes'
		> = {
			type: PduTypeRoomName,
			// @ts-ignore not sure why this is not working
			content: { name } as PduRoomNameEventContent,
			sender: sender,
			origin: sender.split(':').pop(),
			origin_server_ts: Date.now(),
			room_id: roomId,
			state_key: '',
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newJoinRuleEvent(
		roomId: string,
		sender: string,
		joinRule: PduJoinRuleEventContent['join_rule'],
		roomVersion: RoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: Omit<
			PduForType<typeof PduTypeRoomJoinRules>,
			'signatures' | 'hashes'
		> = {
			type: PduTypeRoomJoinRules,
			content: { join_rule: joinRule },
			sender: sender,
			origin: sender.split(':').pop(),
			origin_server_ts: Date.now(),
			room_id: roomId,
			state_key: '',
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newCanonicalAliasEvent(
		roomId: string,
		sender: string,
		alias: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: Omit<
			PduForType<typeof PduTypeRoomCanonicalAlias>,
			'signatures' | 'hashes'
		> = {
			type: PduTypeRoomCanonicalAlias,
			content: { alias, alt_aliases: [] },
			sender: sender,
			origin: sender.split(':').pop(),
			origin_server_ts: Date.now(),
			room_id: roomId,
			state_key: '',
			auth_events: [],
			depth: 0,
			prev_events: [],
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newReactionEvent(
		roomId: string,
		sender: string,
		eventIdToReact: string,
		key: string, // emoji
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		// Note: event_id will be filled by the event wrapper on first access
		const eventPartial = {
			type: PduTypeReaction,
			content: {
				'm.relates_to': {
					rel_type: 'm.annotation',
					event_id: eventIdToReact,
					key: key,
				},
			},
			sender: sender,
			origin: sender.split(':').pop() ?? '',
			origin_server_ts: Date.now(),
			room_id: roomId,
			// NO state_key - this is a timeline event
			prev_events: [],
			auth_events: [],
			depth: 0,
			unsigned: {},
		};

		return PersistentEventFactory.createFromRawEvent(
			eventPartial as unknown as Omit<Pdu, 'signatures' | 'hashes'>,
			roomVersion,
		);
	}

	static newRedactionEvent(
		roomId: string,
		sender: string,
		eventIdToRedact: string,
		reason?: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		// Note: event_id will be filled by the event wrapper on first access
		const eventPartial = {
			type: PduTypeRoomRedaction,
			redacts: eventIdToRedact,
			content: {
				redacts: eventIdToRedact,
				...(reason && { reason }),
			},
			sender: sender,
			origin: sender.split(':').pop() ?? '',
			origin_server_ts: Date.now(),
			room_id: roomId,
			// NO state_key - this is a timeline event
			prev_events: [],
			auth_events: [],
			depth: 0,
			unsigned: {},
		};

		return PersistentEventFactory.createFromRawEvent(
			eventPartial as unknown as Omit<Pdu, 'signatures' | 'hashes'>,
			roomVersion,
		);
	}

	static newMessageEvent(
		roomId: string,
		sender: string,
		text: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: Omit<
			PduForType<typeof PduTypeRoomMessage>,
			'signatures' | 'hashes'
		> = {
			type: PduTypeRoomMessage,
			content: {
				msgtype: 'm.text' as const,
				body: text,
			},
			sender: sender,
			origin: sender.split(':').pop(),
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}
}
