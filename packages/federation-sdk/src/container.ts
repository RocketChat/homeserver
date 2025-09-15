import 'reflect-metadata';

import type { EventStagingStore, EventStore } from '@hs/core';
import type { Emitter } from '@rocket.chat/emitter';
import type { Collection, WithId } from 'mongodb';
import { container } from 'tsyringe';

import type { HomeserverEventSignatures } from './index';
import { StagingAreaListener } from './listeners/staging-area.listener';
import { StagingAreaQueue } from './queues/staging-area.queue';
import { EventStagingRepository } from './repositories/event-staging.repository';
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
		useValue: db.collection<Lock>('rocketchat_federation_lock'),
	});

	container.register<Collection<Room>>('RoomCollection', {
		useValue: db.collection<Room>('rocketchat_federation_rooms'),
	});

	container.register<Collection<WithId<StateStore>>>('StateCollection', {
		useValue: db.collection<WithId<StateStore>>('rocketchat_federation_states'),
	});

	container.register<Collection<Server>>('ServerCollection', {
		useValue: db.collection<Server>('rocketchat_federation_servers'),
	});

	container.registerSingleton(EventRepository);
	container.registerSingleton(EventStagingRepository);
	container.registerSingleton(KeyRepository);
	container.registerSingleton(LockRepository);
	container.registerSingleton(RoomRepository);
	container.registerSingleton(StateRepository);
	container.registerSingleton(ServerRepository);

	container.registerSingleton(FederationRequestService);
	container.registerSingleton(FederationService);
	container.registerSingleton(StateService);
	container.registerSingleton(EventAuthorizationService);
	container.registerSingleton('EventFetcherService', EventFetcherService);
	container.registerSingleton(EventService);
	container.registerSingleton(EventEmitterService);
	container.registerSingleton(InviteService);
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

	const eventEmitterService = container.resolve(EventEmitterService);
	if (emitter) {
		eventEmitterService.setEmitter(emitter);
	} else {
		eventEmitterService.initializeStandalone();
	}

	container.resolve(StagingAreaListener);

	return container;
}
