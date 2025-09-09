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
		event: PduWithHashesAndSignaturesOptional,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	): PersistentEventBase<RoomVersion> {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

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

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newMembershipEvent(
		roomId: string,
		sender: string,
		userId: string,
		membership: PduMembershipEventContent['membership'],
		roomInformation: PduCreateEventContent,
		reason?: string,
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
			...(reason && { reason }),
		};

		const eventPartial: PartialEvent<PduForType<'m.room.member'>> = {
			type: 'm.room.member',
			content: membershipContent,
			sender: sender,
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

		const eventPartial: PartialEvent<PduForType<'m.room.power_levels'>> = {
			type: 'm.room.power_levels',
			content: content,
			sender: sender,
			origin_server_ts: Date.now(),
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

		const eventPartial: PartialEvent<PduForType<'m.room.name'>> = {
			type: 'm.room.name',
			content: { name },
			sender: sender,
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

		const eventPartial: PartialEvent<PduForType<'m.room.join_rules'>> = {
			type: 'm.room.join_rules',
			content: { join_rule: joinRule },
			sender: sender,
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

		const eventPartial: PartialEvent<PduForType<'m.room.canonical_alias'>> = {
			type: 'm.room.canonical_alias',
			content: { alias, alt_aliases: [] },
			sender: sender,
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

		return PersistentEventFactory.createFromRawEvent(
			{
				type: 'm.reaction',
				content: {
					'm.relates_to': {
						rel_type: 'm.annotation',
						event_id: eventIdToReact,
						key: key,
					},
				},
				sender: sender,
				origin_server_ts: Date.now(),
				room_id: roomId,
				// NO state_key - this is a timeline event
				prev_events: [],
				auth_events: [],
				depth: 0,
				unsigned: {},
			},
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
		const eventPartial: PartialEvent<PduForType<'m.room.redaction'>> = {
			type: 'm.room.redaction',
			redacts: eventIdToRedact,
			content: {
				redacts: eventIdToRedact,
				...(reason && { reason }),
			},
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			// NO state_key - this is a timeline event
			prev_events: [],
			auth_events: [],
			depth: 0,
			unsigned: {},
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
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

		const eventPartial: PartialEvent<PduForType<'m.room.message'>> = {
			type: 'm.room.message',
			content: {
				msgtype: 'm.text' as const,
				body: text,
			},
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newRichTextMessageEvent(
		roomId: string,
		sender: string,
		rawText: string,
		formattedBody: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: PartialEvent<PduForType<'m.room.message'>> = {
			type: 'm.room.message',
			content: {
				msgtype: 'm.text',
				body: rawText,
				formatted_body: formattedBody,
				format: 'org.matrix.custom.html',
			},
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newFileMessageEvent(
		roomId: string,
		sender: string,
		content: {
			body: string;
			msgtype: 'm.image' | 'm.file' | 'm.video' | 'm.audio';
			url: string;
			info?: {
				size?: number;
				mimetype?: string;
				w?: number;
				h?: number;
				duration?: number;
				thumbnail_url?: string;
				thumbnail_info?: {
					w?: number;
					h?: number;
					mimetype?: string;
					size?: number;
				};
			};
		},
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: Omit<
			PduForType<'m.room.message'>,
			'signatures' | 'hashes'
		> = {
			type: 'm.room.message',
			content: content as PduForType<'m.room.message'>['content'],
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newReplyToRichTextMessageEvent(
		roomId: string,
		sender: string,
		rawText: string,
		formattedBody: string,
		eventToReplyTo: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: PartialEvent<PduForType<'m.room.message'>> = {
			type: 'm.room.message',
			content: {
				body: rawText,
				format: 'org.matrix.custom.html',
				formatted_body: formattedBody,
				'm.relates_to': {
					'm.in_reply_to': { event_id: eventToReplyTo },
				},
				msgtype: 'm.text',
			},
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newMessageUpdateEvent(
		roomId: string,
		sender: string,
		newText: string,
		eventIdToReplace: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: PartialEvent<PduForType<'m.room.message'>> = {
			type: 'm.room.message',
			content: {
				msgtype: 'm.text' as const,
				body: `* ${newText}`, // Fallback for clients not supporting edits
				'm.relates_to': {
					rel_type: 'm.replace',
					event_id: eventIdToReplace,
				},
				'm.new_content': {
					msgtype: 'm.text' as const,
					body: newText, // The actual new content
				},
			},
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newRichTextMessageUpdateEvent(
		roomId: string,
		sender: string,
		newRawText: string,
		newFormattedText: string,
		eventIdToReplace: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: PartialEvent<PduForType<'m.room.message'>> = {
			type: 'm.room.message',
			content: {
				msgtype: 'm.text' as const,
				body: `* ${newRawText}`, // Fallback for clients not supporting edits
				formatted_body: newFormattedText,
				format: 'org.matrix.custom.html',
				'm.relates_to': {
					rel_type: 'm.replace',
					event_id: eventIdToReplace,
				},
				'm.new_content': {
					msgtype: 'm.text' as const,
					body: newRawText, // The actual new content
					formatted_body: newFormattedText,
					format: 'org.matrix.custom.html',
				},
			},
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newThreadMessageEvent(
		roomId: string,
		sender: string,
		text: string,
		threadRootEventId: string,
		latestThreadEventId?: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: PartialEvent<PduForType<'m.room.message'>> = {
			type: 'm.room.message',
			content: {
				msgtype: 'm.text' as const,
				body: text,
				'm.relates_to': {
					rel_type: 'm.thread' as const,
					event_id: threadRootEventId,
					is_falling_back: true,
					...(latestThreadEventId && {
						'm.in_reply_to': {
							event_id: latestThreadEventId,
						},
					}),
				},
			},
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newRichTextThreadMessageEvent(
		roomId: string,
		sender: string,
		rawText: string,
		formattedText: string,
		threadRootEventId: string,
		latestThreadEventId?: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: PartialEvent<PduForType<'m.room.message'>> = {
			type: 'm.room.message',
			content: {
				msgtype: 'm.text' as const,
				body: rawText,
				formatted_body: formattedText,
				format: 'org.matrix.custom.html',
				'm.relates_to': {
					rel_type: 'm.thread' as const,
					event_id: threadRootEventId,
					is_falling_back: true,
					...(latestThreadEventId && {
						'm.in_reply_to': {
							event_id: latestThreadEventId,
						},
					}),
				},
			},
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newReplyToRichTextThreadMessageEvent(
		roomId: string,
		sender: string,
		rawText: string,
		formattedText: string,
		threadRootEventId: string,
		eventToReplyTo: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: PartialEvent<PduForType<'m.room.message'>> = {
			type: 'm.room.message',
			content: {
				msgtype: 'm.text',
				body: rawText,
				format: 'org.matrix.custom.html',
				formatted_body: formattedText,
				'm.relates_to': {
					rel_type: 'm.thread',
					event_id: threadRootEventId,
					is_falling_back: false,
					'm.in_reply_to': {
						event_id: eventToReplyTo,
					},
				},
			},
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newRoomTopicEvent(
		roomId: string,
		sender: string,
		topic: string,
		roomVersion: RoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: PartialEvent<PduForType<'m.room.topic'>> = {
			type: 'm.room.topic',
			content: { topic },
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			state_key: '',
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newHistoryVisibilityEvent(
		roomId: string,
		sender: string,
		historyVisibility: 'invited' | 'joined' | 'shared' | 'world_readable',
		roomVersion: RoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: Omit<
			PduForType<'m.room.history_visibility'>,
			'signatures' | 'hashes'
		> = {
			type: 'm.room.history_visibility',
			content: { history_visibility: historyVisibility },
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			state_key: '',
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	static newGuestAccessEvent(
		roomId: string,
		sender: string,
		guestAccess: 'can_join' | 'forbidden',
		roomVersion: RoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		const eventPartial: Omit<
			PduForType<'m.room.guest_access'>,
			'signatures' | 'hashes'
		> = {
			type: 'm.room.guest_access',
			content: { guest_access: guestAccess },
			sender: sender,
			origin_server_ts: Date.now(),
			room_id: roomId,
			state_key: '',
			prev_events: [],
			auth_events: [],
			depth: 0,
		};

		return PersistentEventFactory.createFromRawEvent(eventPartial, roomVersion);
	}

	/**
	 * Create a new direct message membership event with is_direct flag
	 */
	static newDirectMessageMembershipEvent(
		roomId: string,
		sender: string,
		userId: string,
		membership: PduMembershipEventContent['membership'],
		roomInformation: PduCreateEventContent,
		reason?: string,
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
			is_direct: true,
			...(reason && { reason }),
		};

		const eventPartial: Omit<
			PduForType<'m.room.member'>,
			'signatures' | 'hashes'
		> = {
			type: 'm.room.member',
			content: membershipContent,
			sender: sender,
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

	/**
	 * Create initial state events for a direct message room
	 */
	static createDirectMessageRoomEvents(
		creatorUserId: string,
		targetUserId: string,
		roomVersion: RoomVersion = PersistentEventFactory.defaultRoomVersion,
	) {
		if (!PersistentEventFactory.isSupportedRoomVersion(roomVersion)) {
			throw new Error(`Room version ${roomVersion} is not supported`);
		}

		// Create the room
		const createEvent = PersistentEventFactory.newCreateEvent(
			creatorUserId,
			roomVersion,
		);
		const roomId = createEvent.roomId;

		// Create membership event for creator
		const creatorMembershipEvent =
			PersistentEventFactory.newDirectMessageMembershipEvent(
				roomId,
				creatorUserId,
				creatorUserId,
				'join',
				createEvent.getContent(),
			);

		// Create power levels - equal power for both users in DM
		const powerLevelsContent: PduPowerLevelsEventContent = {
			users: {
				[creatorUserId]: 50,
				[targetUserId]: 50,
			},
			users_default: 0,
			events: {},
			events_default: 0,
			state_default: 50,
			ban: 50,
			kick: 50,
			redact: 50,
			invite: 50,

			// historical: 100, TODO: check if historical exists in spec - m.power_levels
		};

		const powerLevelsEvent = PersistentEventFactory.newPowerLevelEvent(
			roomId,
			creatorUserId,
			powerLevelsContent,
			roomVersion,
		);

		// Create join rules - invite only for DMs
		const joinRulesEvent = PersistentEventFactory.newJoinRuleEvent(
			roomId,
			creatorUserId,
			'invite',
			roomVersion,
		);

		// Create history visibility - shared for DMs (essential for proper DM behavior)
		const historyVisibilityEvent =
			PersistentEventFactory.newHistoryVisibilityEvent(
				roomId,
				creatorUserId,
				'shared',
				roomVersion,
			);

		// Create guest access - forbidden for DMs (essential for proper DM behavior)
		const guestAccessEvent = PersistentEventFactory.newGuestAccessEvent(
			roomId,
			creatorUserId,
			'forbidden',
			roomVersion,
		);

		return {
			roomId,
			createEvent,
			creatorMembershipEvent,
			powerLevelsEvent,
			joinRulesEvent,
			historyVisibilityEvent,
			guestAccessEvent,
		};
	}
}
