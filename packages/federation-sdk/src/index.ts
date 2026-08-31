import 'reflect-metadata';

import {
	APPSERVICE_CONFIG_PROVIDER,
	type AppServiceConfigProvider,
	type AppServiceState,
	type AppServiceTransaction,
	EventRouterService,
	TransactionSenderService,
} from '@rocket.chat/appservice';
import { createLogger } from '@rocket.chat/federation-core';
import type { EventStagingStore } from '@rocket.chat/federation-core';
import type { EventID, EventStore, RoomID } from '@rocket.chat/federation-room';
import { Collection } from 'mongodb';
import { container } from 'tsyringe';

import { StagingAreaListener } from './listeners/staging-area.listener';
import { Key } from './repositories/key.repository';
import { Lock } from './repositories/lock.repository';
import { RoomAlias } from './repositories/room-alias.repository';
import { Room } from './repositories/room.repository';
import { Server } from './repositories/server.repository';
import { StateGraphStore } from './repositories/state-graph.repository';
import { Upload } from './repositories/upload.repository';
import { User } from './repositories/user.repository';
import { FederationSDK } from './sdk';
import { ConfigService } from './services/config.service';
import { DatabaseConnectionService } from './services/database-connection.service';
import { EventService } from './services/event.service';
import { StateService } from './services/state.service';

container.register<AppServiceConfigProvider>(APPSERVICE_CONFIG_PROVIDER, {
	useValue: {
		get serverName() {
			return container.resolve(ConfigService).serverName;
		},
	},
});

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
export { eventSchemas, roomV10Schemas, roomV11Schemas, type BaseEventType } from './utils/event-schemas';
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

	container.register<Collection<RoomAlias>>('RoomAliasCollection', {
		useValue: db.collection<RoomAlias>('rocketchat_federation_room_aliases'),
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

	container.register<Collection<AppServiceState>>('AppServiceStateCollection', {
		useValue: db.collection<AppServiceState>('rocketchat_federation_appservices_state'),
	});

	container.register<Collection<AppServiceTransaction>>('AppServiceTxnCollection', {
		useValue: db.collection<AppServiceTransaction>('rocketchat_federation_appservices_txns'),
	});

	// this is required to initialize the listener and register the queue handler
	container.resolve(StagingAreaListener);

	// Wire the event router into the homeserver event emitter so appservices
	// receive transactions for events in their namespaces.
	const eventRouter = container.resolve(EventRouterService);
	const stateService = container.resolve(StateService);
	const routingLogger = createLogger('AppServiceRouting');
	eventRouter.setRoomStateResolver(async (roomId) => {
		try {
			const state = await stateService.getLatestRoomState2(roomId as RoomID);
			return { aliases: state.getCanonicalAliases(), members: state.members };
		} catch (error) {
			// This resolver only runs for rooms whose state was just persisted, so a
			// failure here is anomalous (not the routine unknown-room case) — surface it.
			routingLogger.error({ msg: 'Failed to resolve room state for appservice routing', roomId, err: error });
			return { aliases: [], members: [] };
		}
	});

	// Lets the appservice transaction sender rebuild retry payloads from the
	// event store (it only persists event ids on the transaction record).
	const eventService = container.resolve(EventService);
	const transactionSender = container.resolve(TransactionSenderService);
	transactionSender.setEventResolver(async (eventIds) => {
		const found = await eventService.getEventsByIds(eventIds as EventID[]);
		const byId = new Map(found.map(({ _id, event }) => [_id as string, event]));
		return eventIds.map((id): Record<string, unknown> => {
			const event = byId.get(id);
			if (!event) {
				// Delivering a partial payload would let the recoverer complete the txn
				// while silently dropping events — surface it so the txn is retried
				// instead of falsely completed.
				throw new Error(`Failed to resolve event ${id} for appservice transaction retry`);
			}
			return { event_id: id, ...event };
		});
	});

	// once the db is initialized we look for old staged events and try to process them
	setTimeout(async () => {
		const eventService = container.resolve(EventService);
		await eventService.processOldStagedEvents();
	}, 5000);
}

export const federationSDK = container.resolve(FederationSDK);
