import 'reflect-metadata';

import type { EventStore } from '@hs/core';
import type { Emitter } from '@rocket.chat/emitter';
import type { Collection, WithId } from 'mongodb';
import { container } from 'tsyringe';

import type { HomeserverEventSignatures } from './index';
import { StagingAreaListener } from './listeners/staging-area.listener';
import { StagingAreaQueue } from './queues/staging-area.queue';
import { EventRepository } from './repositories/event.repository';
import { Key, KeyRepository } from './repositories/key.repository';
import { Lock, LockRepository } from './repositories/lock.repository';
import { Room, RoomRepository } from './repositories/room.repository';
import { Server, ServerRepository } from './repositories/server.repository';
import { StateRepository, StateStore } from './repositories/state.repository';
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

export interface FederationContainerOptions {
	emitter?: Emitter<HomeserverEventSignatures>;
}

export async function createFederationContainer(
	options: FederationContainerOptions,
	configInstance: ConfigService,
) {
	const { emitter } = options;

	container.register<ConfigService>(ConfigService, {
		useValue: configInstance,
	});

	container.registerSingleton(DatabaseConnectionService);
	const dbConnection = container.resolve(DatabaseConnectionService);
	const db = await dbConnection.getDb();

	container.registerSingleton(StagingAreaQueue);

	container.register<Collection<EventStore>>('EventCollection', {
		// TODO change collection name to include at least the "rocketchat_" prefix
		useValue: db.collection<EventStore>('events'),
	});

	container.register<Collection<Key>>('KeyCollection', {
		// TODO change collection name to include at least the "rocketchat_" prefix
		useValue: db.collection<Key>('keys'),
	});

	container.register<Collection<Lock>>('LockCollection', {
		useValue: db.collection<Lock>('rocketchat_federation_lock'),
	});

	container.register<Collection<Room>>('RoomCollection', {
		// TODO change collection name to include at least the "rocketchat_" prefix
		useValue: db.collection<Room>('rooms'),
	});

	container.register<Collection<WithId<StateStore>>>('StateCollection', {
		// TODO change collection name to include at least the "rocketchat_" prefix
		useValue: db.collection<WithId<StateStore>>('states'),
	});

	container.register<Collection<Server>>('ServerCollection', {
		// TODO change collection name to include at least the "rocketchat_" prefix
		useValue: db.collection<Server>('servers'),
	});

	container.registerSingleton(EventRepository);
	container.registerSingleton(KeyRepository);
	container.registerSingleton(RoomRepository);
	container.registerSingleton(StateRepository);
	container.registerSingleton(ServerRepository);

	container.registerSingleton(FederationRequestService);
	container.registerSingleton(SignatureVerificationService);
	container.registerSingleton(FederationService);
	container.registerSingleton(StateService);
	container.registerSingleton(EventAuthorizationService);
	container.registerSingleton('EventFetcherService', EventFetcherService);
	container.registerSingleton(EventStateService);
	container.registerSingleton(EventService);
	container.registerSingleton(EventEmitterService);
	container.registerSingleton(InviteService);
	container.registerSingleton(LockRepository);
	container.registerSingleton(MediaService);
	container.registerSingleton(MessageService);
	container.registerSingleton(MissingEventService);
	container.registerSingleton(ProfilesService);
	container.registerSingleton(RoomService);
	container.registerSingleton(ServerService);
	container.registerSingleton(WellKnownService);
	container.registerSingleton(SendJoinService);
	container.registerSingleton(StagingAreaService);
	container.registerSingleton(EduService);

	container.registerSingleton(StagingAreaListener);

	// container.register(LockManagerService, {
	// 	useFactory: () => new LockManagerService(lockManagerOptions),
	// });

	const eventEmitterService = container.resolve(EventEmitterService);
	if (emitter) {
		eventEmitterService.setEmitter(emitter);
	} else {
		eventEmitterService.initializeStandalone();
	}

	// container.resolve(MissingEventListener);
	container.resolve(StagingAreaListener);

	return container;
}
