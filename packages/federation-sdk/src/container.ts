import 'reflect-metadata';

import type { EventBaseWithOptionalId, EventStore } from '@hs/core';
import type { StateMapKey } from '@hs/room';
import type { Emitter } from '@rocket.chat/emitter';
import type { Collection, WithId } from 'mongodb';
import { container } from 'tsyringe';

import type { HomeserverEventSignatures } from './index';
import { MissingEventListener } from './listeners/missing-event.listener';
import { StagingAreaListener } from './listeners/staging-area.listener';
import { MissingEventsQueue } from './queues/missing-event.queue';
import { StagingAreaQueue } from './queues/staging-area.queue';
import { EventRepository } from './repositories/event.repository';
import { KeyRepository } from './repositories/key.repository';
import { RoomRepository } from './repositories/room.repository';
import { ServerRepository } from './repositories/server.repository';
import { StateRepository } from './repositories/state.repository';
import { ConfigService } from './services/config.service';
import { DatabaseConnectionService } from './services/database-connection.service';
import { EduService } from './services/edu.service';
import { EventAuthorizationService } from './services/event-authorization.service';
import { EventEmitterService } from './services/event-emitter.service';
import { EventFetcherService } from './services/event-fetcher.service';
import { EventStateService } from './services/event-state.service';
import { EventService } from './services/event.service';
import { FederationRequestService } from './services/federation-request.service';
import { FederationService } from './services/federation.service';
import { InviteService } from './services/invite.service';
import { MediaService } from './services/media.service';
import { MessageService } from './services/message.service';
import { MissingEventService } from './services/missing-event.service';
import { ProfilesService } from './services/profiles.service';
import { RoomService } from './services/room.service';
import { SendJoinService } from './services/send-join.service';
import { ServerService } from './services/server.service';
import { SignatureVerificationService } from './services/signature-verification.service';
import { StagingAreaService } from './services/staging-area.service';
import { StateService } from './services/state.service';
import { WellKnownService } from './services/well-known.service';
import { LockManagerService } from './utils/lock.decorator';
import type { LockConfig } from './utils/lock.decorator';

// Type definitions for collections
type Key = {
	origin: string;
	key_id: string;
	public_key: string;
	valid_until: Date;
};

type Room = {
	_id: string;
	room: {
		name: string;
		join_rules: string;
		version: string;
		alias?: string;
		canonical_alias?: string;
		deleted?: boolean;
		tombstone_event_id?: string;
	};
};

type Server = {
	name: string;
	keys: {
		[key: string]: {
			key: string;
			validUntil: number;
		};
	};
};

type StateStore = {
	delta: {
		identifier: StateMapKey;
		eventId: string;
	};
	createdAt: Date;
	roomId: string;
	prevStateIds: string[];
};

export interface FederationContainerOptions {
	emitter?: Emitter<HomeserverEventSignatures>;
	lockManagerOptions?: LockConfig;
}

export function createFederationContainer(
	options: FederationContainerOptions,
	configInstance: ConfigService,
) {
	const { emitter, lockManagerOptions = { type: 'memory' } } = options;

	// Register ConfigService with both string and class tokens
	container.register<ConfigService>('ConfigService', {
		useValue: configInstance,
	});
	container.register<ConfigService>(ConfigService, {
		useValue: configInstance,
	});
	container.registerSingleton(
		'DatabaseConnectionService',
		DatabaseConnectionService,
	);
	container.registerSingleton(
		'FederationRequestService',
		FederationRequestService,
	);
	container.registerSingleton(
		'SignatureVerificationService',
		SignatureVerificationService,
	);
	container.registerSingleton('FederationService', FederationService);

	// Register MongoDB collections
	container.register('eventsCollection', {
		useFactory: async () => {
			const dbConnection = container.resolve<DatabaseConnectionService>(
				'DatabaseConnectionService',
			);
			const db = await dbConnection.getDb();
			return db.collection<EventStore>('events');
		},
	});

	container.register('finalStateEventsCollection', {
		useFactory: async () => {
			const dbConnection = container.resolve<DatabaseConnectionService>(
				'DatabaseConnectionService',
			);
			const db = await dbConnection.getDb();
			return db.collection<EventBaseWithOptionalId>('final_state_events');
		},
	});

	container.register('statesCollection', {
		useFactory: async () => {
			const dbConnection = container.resolve<DatabaseConnectionService>(
				'DatabaseConnectionService',
			);
			const db = await dbConnection.getDb();
			return db.collection<WithId<StateStore>>('states');
		},
	});

	container.register('keysCollection', {
		useFactory: async () => {
			const dbConnection = container.resolve<DatabaseConnectionService>(
				'DatabaseConnectionService',
			);
			const db = await dbConnection.getDb();
			return db.collection<Key>('keys');
		},
	});

	container.register('roomsCollection', {
		useFactory: async () => {
			const dbConnection = container.resolve<DatabaseConnectionService>(
				'DatabaseConnectionService',
			);
			const db = await dbConnection.getDb();
			return db.collection<Room>('rooms');
		},
	});

	container.register('serversCollection', {
		useFactory: async () => {
			const dbConnection = container.resolve<DatabaseConnectionService>(
				'DatabaseConnectionService',
			);
			const db = await dbConnection.getDb();
			return db.collection<Server>('servers');
		},
	});

	// Register repositories with their collections
	container.register('EventRepository', {
		useFactory: async () => {
			const collection = (await container.resolve(
				'eventsCollection',
			)) as Collection<EventStore>;
			return new EventRepository(collection);
		},
	});

	container.register('KeyRepository', {
		useFactory: async () => {
			const collection = (await container.resolve(
				'keysCollection',
			)) as Collection<Key>;
			return new KeyRepository(collection);
		},
	});

	container.register('RoomRepository', {
		useFactory: async () => {
			const collection = (await container.resolve(
				'roomsCollection',
			)) as Collection<Room>;
			return new RoomRepository(collection);
		},
	});

	container.register('ServerRepository', {
		useFactory: async () => {
			const collection = (await container.resolve(
				'serversCollection',
			)) as Collection<Server>;
			return new ServerRepository(collection);
		},
	});

	container.register('StateRepository', {
		useFactory: async () => {
			const collection = (await container.resolve(
				'statesCollection',
			)) as Collection<WithId<StateStore>>;
			return new StateRepository(collection);
		},
	});

	// Register repositories
	container.registerSingleton('EventRepository', EventRepository);
	container.registerSingleton('KeyRepository', KeyRepository);
	container.registerSingleton('RoomRepository', RoomRepository);
	container.registerSingleton('ServerRepository', ServerRepository);
	container.registerSingleton('StateRepository', StateRepository);

	// Register business services
	container.registerSingleton('StateService', StateService);
	container.registerSingleton(EventAuthorizationService);
	container.registerSingleton(EventFetcherService);
	container.registerSingleton(EventStateService);
	container.registerSingleton('EventService', EventService);
	container.registerSingleton('EventEmitterService', EventEmitterService);
	container.registerSingleton(InviteService);
	container.registerSingleton(MediaService);
	container.registerSingleton(MessageService);
	container.registerSingleton(MissingEventService);
	container.registerSingleton(ProfilesService);
	container.registerSingleton('RoomService', RoomService);
	container.registerSingleton(RoomService);
	container.registerSingleton(ServerService);
	container.registerSingleton(WellKnownService);
	container.registerSingleton(SendJoinService);

	// Register queues
	container.registerSingleton('MissingEventsQueue', MissingEventsQueue);
	container.registerSingleton('StagingAreaQueue', StagingAreaQueue);

	// Register listeners
	container.registerSingleton('MissingEventListener', MissingEventListener);
	container.registerSingleton('StagingAreaListener', StagingAreaListener);
	container.registerSingleton('EduService', EduService);

	container.registerSingleton('StagingAreaService', StagingAreaService);
	container.registerSingleton(StagingAreaService);

	// Register lock manager with configuration
	container.register(LockManagerService, {
		useFactory: () => new LockManagerService(lockManagerOptions),
	});

	// Configure event emitter
	const eventEmitterService = container.resolve(EventEmitterService);
	if (emitter) {
		eventEmitterService.setEmitter(emitter);
	} else {
		eventEmitterService.initializeStandalone();
	}

	// Initialize listeners
	const y = container.resolve(StagingAreaListener);
	const x = container.resolve(MissingEventListener);

	// @ts-ignore
	x.stagingAreaService.missingEventsService.missingEventsQueue =
		// @ts-ignore
		x.missingEventsQueue;
	// @ts-ignore
	x.stagingAreaService.stagingAreaQueue = y.stagingAreaQueue;

	return container;
}
