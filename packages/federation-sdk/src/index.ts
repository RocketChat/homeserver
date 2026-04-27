import 'reflect-metadata';

import {
	type AppServiceRegistration,
	type AppServiceState,
	type AppServiceTransaction,
	EventRouterService,
	RegistrationService,
} from '@rocket.chat/appservice';
import type { EventStagingStore } from '@rocket.chat/federation-core';
import type { EventStore } from '@rocket.chat/federation-room';
import { Collection } from 'mongodb';
import { container } from 'tsyringe';

import { StagingAreaListener } from './listeners/staging-area.listener';
import { Key } from './repositories/key.repository';
import { Lock } from './repositories/lock.repository';
import { Room } from './repositories/room.repository';
import { Server } from './repositories/server.repository';
import { StateGraphStore } from './repositories/state-graph.repository';
import { Upload } from './repositories/upload.repository';
import { User } from './repositories/user.repository';
import { FederationSDK } from './sdk';
import { DatabaseConnectionService } from './services/database-connection.service';
import { EventEmitterService } from './services/event-emitter.service';
import { EventService } from './services/event.service';

export { FederationRequestError } from './services/federation-request.service';
export { EventEmitterService } from './services/event-emitter.service';

export type { CachedAppService, AppServiceRegistration, AppServiceState } from '@rocket.chat/appservice';
export type { PingResult, PingError } from '@rocket.chat/appservice';

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
export type { EventStore, FileMessageType, PresenceState, FileMessageContent, MessageType, Membership } from '@rocket.chat/federation-core';
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
export { eventSchemas, roomV10Schemas, type BaseEventType } from './utils/event-schemas';
export { errCodes } from './utils/response-codes';
export { NotAllowedError } from './services/invite.service';
export { FederationValidationService, FederationValidationError } from './services/federation-validation.service';

export type { HomeserverEventSignatures } from '@rocket.chat/federation-core';

export { roomIdSchema, userIdSchema, eventIdSchema, extractDomainFromId } from '@rocket.chat/federation-room';

export async function init({
	dbConfig,
}: {
	dbConfig: {
		uri: string;
		poolSize: number;
	};
}) {
	const dbConnection = new DatabaseConnectionService(dbConfig);
	const db = await dbConnection.getDb();

	container.register<Collection<EventStore>>('EventCollection', {
		useValue: db.collection<EventStore>('rocketchat_federation_events'),
	});

	container.register<Collection<EventStagingStore>>('EventStagingCollection', {
		useValue: db.collection<EventStagingStore>('rocketchat_federation_events_staging'),
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

	container.register<Collection<{ etag: string }>>('AvatarCollection', {
		useValue: db.collection<{ etag: string }>('rocketchat_avatars'),
	});

	container.register<Collection<StateGraphStore>>('StateGraphCollection', {
		useValue: db.collection<StateGraphStore>('rocketchat_federation_state_graphs'),
	});

	container.register<Collection<User>>('UserCollection', {
		useValue: db.collection<User>('users'),
	});

	container.register<Collection<AppServiceRegistration>>('AppServiceCollection', {
		useValue: db.collection<AppServiceRegistration>('rocketchat_appservices'),
	});

	container.register<Collection<AppServiceState>>('AppServiceStateCollection', {
		useValue: db.collection<AppServiceState>('rocketchat_appservices_state'),
	});

	container.register<Collection<AppServiceTransaction>>('AppServiceTxnCollection', {
		useValue: db.collection<AppServiceTransaction>('rocketchat_appservices_txns'),
	});

	// this is required to initialize the listener and register the queue handler
	container.resolve(StagingAreaListener);

	// Load any existing appservice registrations into cache.
	await container.resolve(RegistrationService).initialize();

	// Wire the event router into the homeserver event emitter so appservices
	// receive transactions for events in their namespaces.
	const eventRouter = container.resolve(EventRouterService);
	// TODO: replace these stubs with real lookups against room state once exposed by the SDK.
	eventRouter.setResolvers(
		async () => [],
		async () => [],
	);
	eventRouter.subscribe(container.resolve(EventEmitterService));

	// once the db is initialized we look for old staged events and try to process them
	setTimeout(async () => {
		const eventService = container.resolve(EventService);
		await eventService.processOldStagedEvents();
	}, 5000);
}

export const federationSDK = container.resolve(FederationSDK);
