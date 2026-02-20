import type { EventID } from '@rocket.chat/federation-room';

import { type EventBase, createEventBase } from './eventBase';
import { createEventWithId } from './utils/createSignedEvent';

export type TextMessageType = 'm.text' | 'm.emote' | 'm.notice';
export type FileMessageType = 'm.image' | 'm.file' | 'm.audio' | 'm.video';
export type LocationMessageType = 'm.location';
export type MessageType = TextMessageType | FileMessageType | LocationMessageType;

// Base message content
type BaseMessageContent = {
	'body': string;
	'm.mentions'?: Record<string, any>;
	'format'?: string;
	'formatted_body'?: string;
	'm.relates_to'?: MessageRelation;
};

// Text message content
export type TextMessageContent = BaseMessageContent & {
	msgtype: TextMessageType;
};

// File message content
export type FileMessageContent = BaseMessageContent & {
	msgtype: FileMessageType;
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
};

// Location message content
export type LocationMessageContent = BaseMessageContent & {
	msgtype: LocationMessageType;
	geo_uri: string;
};

// New content for edits
type NewContent =
	| Pick<TextMessageContent, 'body' | 'msgtype' | 'format' | 'formatted_body'>
	| Pick<FileMessageContent, 'body' | 'msgtype' | 'url' | 'info'>
	| Pick<LocationMessageContent, 'body' | 'msgtype' | 'geo_uri'>;

declare module './eventBase' {
	interface Events {
		'm.room.message': {
			unsigned: {
				age_ts: number;
			};
			content: (TextMessageContent | FileMessageContent | LocationMessageContent) & {
				'm.new_content'?: NewContent;
			};
		};
	}
}

export type MessageRelation = {
	rel_type: RelationType;
	event_id: EventID;
} & (RelationTypeReplace | RelationTypeAnnotation | RelationTypeThread | Record<string, never>);

export type RelationType = 'm.replace' | 'm.annotation' | 'm.thread';

export type RelationTypeReplace = {
	'rel_type': 'm.replace';
	'event_id': EventID;
	'm.new_content'?: {
		body: string;
		msgtype: MessageType;
		format?: string;
		formatted_body?: string;
	};
};

export type RelationTypeAnnotation = {
	rel_type: 'm.annotation';
	event_id: EventID;
	key: string;
};

export type RelationTypeThread = {
	'rel_type': 'm.thread';
	'event_id': EventID;
	'm.in_reply_to'?: {
		event_id: EventID;
		room_id: string;
		sender: string;
		origin_server_ts: number;
	};
	'is_falling_back'?: boolean;
};

export type MessageAuthEvents = {
	'm.room.create': EventID;
	'm.room.power_levels': EventID;
	'm.room.member': EventID;
};

export const isRoomMessageEvent = (event: EventBase): event is RoomMessageEvent => {
	return event.type === 'm.room.message';
};

export interface RoomMessageEvent extends EventBase {
	type: 'm.room.message';
	content: (TextMessageContent | FileMessageContent | LocationMessageContent) & {
		'm.new_content'?: NewContent;
	};
	unsigned: {
		age: number;
		age_ts: number;
	};
}

const isTruthy = <T>(value: T | null | undefined | false | 0 | ''): value is T => {
	return Boolean(value);
};

export const roomMessageEvent = ({
	roomId,
	sender,
	auth_events,
	prev_events,
	depth,
	unsigned,
	content,
	origin,
	ts = Date.now(),
}: {
	roomId: string;
	sender: string;
	auth_events: MessageAuthEvents;
	prev_events: EventID[];
	depth: number;
	unsigned?: RoomMessageEvent['unsigned'];
	content: (TextMessageContent | FileMessageContent | LocationMessageContent) & {
		'm.new_content'?: NewContent;
	};
	origin?: string;
	ts?: number;
}): RoomMessageEvent => {
	return createEventBase('m.room.message', {
		roomId,
		sender,
		auth_events: [auth_events['m.room.create'], auth_events['m.room.power_levels'], auth_events['m.room.member']].filter(isTruthy),
		prev_events,
		depth,
		content,
		origin_server_ts: ts,
		ts,
		origin,
		unsigned: { age_ts: ts, ...unsigned },
	});
};

export const createRoomMessageEvent = createEventWithId(roomMessageEvent);
