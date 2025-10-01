import 'reflect-metadata';

import type { Emitter } from '@rocket.chat/emitter';
import type { EventStagingStore } from '@rocket.chat/federation-core';
import type {
	EventID,
	EventStore,
	PduForType,
} from '@rocket.chat/federation-room';
import { Collection } from 'mongodb';
import { container } from 'tsyringe';
import { StagingAreaListener } from './listeners/staging-area.listener';
import { Key } from './repositories/key.repository';
import { Lock } from './repositories/lock.repository';
import { Room } from './repositories/room.repository';
import { Server } from './repositories/server.repository';
import { StateGraphStore } from './repositories/state-graph.repository';
import { Upload } from './repositories/upload.repository';
import { FederationSDK } from './sdk';
import { DatabaseConnectionService } from './services/database-connection.service';
import { EventEmitterService } from './services/event-emitter.service';
import { EventService } from './services/event.service';

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
	};
	'homeserver.matrix.room.create': {
		room_id: string;
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

export async function init({
	emitter,
	dbConfig,
}: {
	emitter?: Emitter<HomeserverEventSignatures>;
	dbConfig: {
		uri: string;
		name: string;
		poolSize: number;
	};
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

	const eventEmitterService = container.resolve(EventEmitterService);
	if (emitter) {
		eventEmitterService.setEmitter(emitter);
	} else {
		eventEmitterService.initializeStandalone();
	}

	// this is required to initialize the listener and register the queue handler
	container.resolve(StagingAreaListener);

	// once the db is initialized we look for old staged events and try to process them
	setTimeout(async () => {
		const eventService = container.resolve(EventService);
		await eventService.processOldStagedEvents();
	}, 5000);
}

export const federationSDK = container.resolve(FederationSDK);
