import type { EventID, PduForType } from '@rocket.chat/federation-room';

export type HomeserverEventSignatures = {
	'homeserver.ping': {
		message: string;
	};
	'homeserver.matrix.typing': {
		room_id: string;
		user_id: string;
		typing: boolean;
		origin?: string;
	};
	'homeserver.matrix.presence': {
		user_id: string;
		presence: 'online' | 'offline' | 'unavailable';
		last_active_ago?: number;
		origin?: string;
	};
	'homeserver.matrix.receipt': {
		room_id: string;
		user_id: string;
		event_ids: string[];
		ts: number;
		thread_id?: string;
	};
	'homeserver.matrix.encryption': {
		event_id: EventID;
		event: PduForType<'m.room.encryption'>;
	};
	'homeserver.matrix.encrypted': {
		event_id: EventID;
		event: PduForType<'m.room.encrypted'>;
	};
	'homeserver.matrix.room.create': {
		event: PduForType<'m.room.create'>;
		event_id: EventID;
	};
	'homeserver.matrix.message': {
		event_id: EventID;
		event: PduForType<'m.room.message'>;
	};
	'homeserver.matrix.reaction': {
		event_id: EventID;
		event: PduForType<'m.reaction'>;
	};
	'homeserver.matrix.redaction': {
		event_id: EventID;
		event: PduForType<'m.room.redaction'>;
	};
	'homeserver.matrix.membership': {
		event_id: EventID;
		event: PduForType<'m.room.member'>;
	};
	'homeserver.matrix.room.name': {
		event_id: EventID;
		event: PduForType<'m.room.name'>;
	};
	'homeserver.matrix.room.topic': {
		event_id: EventID;
		event: PduForType<'m.room.topic'>;
	};
	'homeserver.matrix.room.server_acl': {
		event_id: EventID;
		event: PduForType<'m.room.server_acl'>;
	};
	'homeserver.matrix.room.power_levels': {
		event_id: EventID;
		event: PduForType<'m.room.power_levels'>;
	};
	'homeserver.matrix.room.role': {
		sender_id: string;
		user_id: string;
		room_id: string;
		role: 'moderator' | 'owner' | 'user';
	};
	'homeserver.matrix.membership.rejected': {
		event: PduForType<'m.room.member'>;
		reason: string;
	};
};
