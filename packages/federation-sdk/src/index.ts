import 'reflect-metadata';

import type {
	EventStagingStore,
	Membership,
	MessageType,
} from '@rocket.chat/federation-core';
import type {
	EventID,
	EventStore,
	PduForType,
} from '@rocket.chat/federation-room';
import { FederationSDK } from './sdk';
import { container } from 'tsyringe';
import { Collection } from 'mongodb';
import { Lock } from './repositories/lock.repository';
import { Room } from './repositories/room.repository';
import { StateGraphStore } from './repositories/state-graph.repository';
import { Upload } from './repositories/upload.repository';
import { DatabaseConnectionService } from './services/database-connection.service';
import { Server } from './repositories/server.repository';
import { Key } from './repositories/key.repository';

export type {
	Pdu,
	PduForType,
	PduMembershipEventContent,
	PduType,
	PersistentEventBase,
	RoomVersion,
	EventID,
	UserID,
	RoomID,
} from '@rocket.chat/federation-room';
export type {
	EventStore,
	FileMessageType,
	PresenceState,
	FileMessageContent,
	MessageType,
	Membership,
} from '@rocket.chat/federation-core';
export { generateEd25519RandomSecretKey } from '@rocket.chat/federation-crypto';

export type {
	MakeJoinResponse,
	SendJoinResponse,
	SendTransactionResponse,
	State,
	StateIds,
	Transaction,
	Version,
} from './specs/federation-api';

// Utility exports
export { getErrorMessage } from './utils/get-error-message';
export { USERNAME_REGEX, ROOM_ID_REGEX } from './utils/validation-regex';
export {
	eventSchemas,
	roomV10Schemas,
	type BaseEventType,
} from './utils/event-schemas';
export { errCodes } from './utils/response-codes';
export { NotAllowedError } from './services/invite.service';

type RelatesTo =
	| {
			rel_type: 'm.replace';
			event_id: EventID;
	  }
	| {
			rel_type: 'm.annotation';
			event_id: EventID;
			key: string;
	  }
	| {
			rel_type: 'm.thread';
			event_id: EventID;
			'm.in_reply_to'?: {
				event_id: EventID;
				room_id: string;
				sender: string;
				origin_server_ts: number;
			};
			is_falling_back?: boolean;
	  }
	| {
			// SPEC: Though rich replies form a relationship to another event, they do not use rel_type to create this relationship.
			// Instead, a subkey named m.in_reply_to is used to describe the reply’s relationship,

			// rich {"body":"quote","m.mentions":{},"m.relates_to":{"is_falling_back":false,"m.in_reply_to":{"event_id":"$0vkvf2Ha_FdWe3zVaoDw3X15VCyZIZRYrHQXuoZDURQ"}},"msgtype":"m.text"}

			'm.in_reply_to': {
				event_id: EventID;
			};
			is_falling_back?: boolean;
	  };

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
	'homeserver.matrix.encryption': {
		event_id: EventID;
		event: PduForType<'m.room.encryption'>;
	};
	'homeserver.matrix.encrypted': {
		event_id: EventID;
		event: PduForType<'m.room.encrypted'>;

		room_id: string;
		sender: string;
		origin_server_ts: number;
		content: {
			algorithm: 'm.megolm.v1.aes-sha2';
			ciphertext: string;
			'm.relates_to'?: RelatesTo;
			device_id?: string;
			sender_key?: string;
			session_id?: string;
		};
	};
	'homeserver.matrix.message': {
		event_id: EventID;
		event: PduForType<'m.room.message'>;

		room_id: string;
		sender: string;
		origin_server_ts: number;
		content: {
			body: string;
			msgtype: MessageType;
			url?: string;
			'm.relates_to'?: RelatesTo;
			'm.new_content'?: {
				body: string;
				msgtype: MessageType;
				'm.mentions'?: Record<string, string>;
			};
			formatted_body?: string;
			info?: {
				mimetype?: string;
				w?: number;
				h?: number;
				size?: number;
				thumbnail_file?: {
					hashes: {
						sha256: string;
					};
					iv: string;
					key: {
						alg: string;
						ext: boolean;
						k: string;
						key_ops: ['encrypt' | 'decrypt'];
						kty: string;
					};
					url: string;
					v: 'v2';
				};
				thumbnail_info?: {
					w?: number;
					h?: number;
					size?: number;
					mimetype?: string;
				};
			};
		};
	};
	'homeserver.matrix.reaction': {
		event_id: EventID;
		event: PduForType<'m.reaction'>;

		room_id: string;
		sender: string;
		origin_server_ts: number;
		content: {
			'm.relates_to': {
				rel_type: 'm.annotation';
				event_id: EventID;
				key: string;
			};
		};
	};
	'homeserver.matrix.redaction': {
		event_id: EventID;
		event: PduForType<'m.room.redaction'>;

		room_id: string;
		sender: string;
		origin_server_ts: number;
		redacts: EventID;
		content: {
			reason?: string;
		};
	};
	'homeserver.matrix.membership': {
		event_id: EventID;
		event: PduForType<'m.room.member'>;

		room_id: string;
		sender: string;
		state_key: string;
		origin_server_ts: number;
		content: {
			membership: Membership;
			displayname?: string;
			avatar_url?: string;
			reason?: string;
		};
	};
	'homeserver.matrix.room.name': {
		event_id: EventID;
		event: PduForType<'m.room.name'>;
		room_id: string; // name of the room being changed
		user_id: string; // user who changed the name
		name: string; // new name of the room
	};
	'homeserver.matrix.room.topic': {
		event_id: EventID;
		event: PduForType<'m.room.topic'>;

		room_id: string; // topic of the room being changed
		user_id: string; // user who changed the topic
		topic: string; // new topic of the room
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
		sender_id: string; // who changed
		user_id: string; // whose changed
		room_id: string; // room where the change happened
		role: 'moderator' | 'owner' | 'user'; // 50, 100, 0
	};
};

export {
	roomIdSchema,
	userIdSchema,
	eventIdSchema,
} from '@rocket.chat/federation-room';

export async function init(dbConfig: {
	uri: string;
	name: string;
	poolSize: number;
}) {
	const dbConnection = new DatabaseConnectionService(dbConfig);
	const db = await dbConnection.getDb();

	container.register<Collection<EventStore>>('EventCollection', {
		useValue: db.collection<EventStore>('rocketchat_federation_events'),
	});

	container.register<Collection<EventStagingStore>>('EventStagingCollection', {
		useValue: db.collection<EventStagingStore>(
			'rocketchat_federation_events_staging',
		),
	});

	container.register<Collection<Key>>('KeyCollection', {
		useValue: db.collection<Key>('rocketchat_federation_keys'),
	});

	container.register<Collection<Lock>>('LockCollection', {
		useValue: db.collection<Lock>('rocketchat_federation_locks'),
	});

	container.register<Collection<Room>>('RoomCollection', {
		useValue: db.collection<Room>('rocketchat_federation_rooms'),
	});

	container.register<Collection<Server>>('ServerCollection', {
		useValue: db.collection<Server>('rocketchat_federation_servers'),
	});

	container.register<Collection<Upload>>('UploadCollection', {
		useValue: db.collection<Upload>('rocketchat_uploads'),
	});

	container.register<Collection<StateGraphStore>>('StateGraphCollection', {
		useValue: db.collection<StateGraphStore>(
			'rocketchat_federation_state_graphs',
		),
	});
}

export const federationSDK = container.resolve(FederationSDK);
