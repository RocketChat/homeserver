import 'reflect-metadata';

import { toUnpaddedBase64 } from '@hs/core';
import type { Emitter } from '@rocket.chat/emitter';
import { container as diContainer } from 'tsyringe';

import { StagingAreaListener } from './listeners/staging-area.listener';
import { MissingEventsQueue } from './queues/missing-event.queue';
import { StagingAreaQueue } from './queues/staging-area.queue';
import { EventRepository } from './repositories/event.repository';
import { KeyRepository } from './repositories/key.repository';
import { RoomRepository } from './repositories/room.repository';
import { ServerRepository } from './repositories/server.repository';
import { StateEventRepository } from './repositories/state-event.repository';
import { StateRepository } from './repositories/state.repository';
import { ConfigService } from './services/config.service';
import { DatabaseConnectionService } from './services/database-connection.service';
import { EventAuthorizationService } from './services/event-authorization.service';
import { EventEmitterService } from './services/event-emitter.service';
import { EventFetcherService } from './services/event-fetcher.service';
import { EventStateService } from './services/event-state.service';
import { EventService } from './services/event.service';
import { FederationRequestService } from './services/federation-request.service';
import { FederationService } from './services/federation.service';
import { InviteService } from './services/invite.service';
import { MessageService } from './services/message.service';
import { MissingEventListener } from './services/missing-event.listener';
import { MissingEventService } from './services/missing-event.service';
import { NotificationService } from './services/notification.service';
import { ProfilesService } from './services/profiles.service';
import { RoomService } from './services/room.service';
import { SendJoinService } from './services/send-join.service';
import { ServerService } from './services/server.service';
import { SignatureVerificationService } from './services/signature-verification.service';
import { StagingAreaService } from './services/staging-area.service';
import { StateService } from './services/state.service';
import { WellKnownService } from './services/well-known.service';
import { LockManagerService } from './utils/lock.decorator';

import type { HomeserverEventSignatures } from './index';
import type { FederationModuleOptions } from './types';
import type { LockConfig } from './utils/lock.decorator';

export interface FederationContainerOptions {
	federationOptions: FederationModuleOptions;
	emitter?: Emitter<HomeserverEventSignatures>;
	lockManagerOptions?: LockConfig;
}

export function createFederationContainer(options: FederationContainerOptions) {
	const {
		emitter,
		federationOptions,
		lockManagerOptions = { type: 'memory' },
	} = options;

	const container = diContainer.createChildContainer();

	container.register<FederationModuleOptions>('FEDERATION_OPTIONS', {
		useValue: federationOptions,
	});

	// Register core services
	container.registerSingleton('ConfigService', ConfigService);
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

	// Register repositories
	container.registerSingleton('EventRepository', EventRepository);
	container.registerSingleton('KeyRepository', KeyRepository);
	container.registerSingleton('RoomRepository', RoomRepository);
	container.registerSingleton('ServerRepository', ServerRepository);
	container.registerSingleton('StateRepository', StateRepository);
	container.registerSingleton('StateEventRepository', StateEventRepository);

	// Register business services
	container.registerSingleton('StateService', StateService);
	container.registerSingleton(EventAuthorizationService);
	container.registerSingleton(EventFetcherService);
	container.registerSingleton(EventStateService);
	container.registerSingleton('EventService', EventService);
	container.registerSingleton(EventEmitterService);
	container.registerSingleton(InviteService);
	container.registerSingleton(MessageService);
	container.registerSingleton(MissingEventService);
	container.registerSingleton(NotificationService);
	container.registerSingleton(ProfilesService);
	container.registerSingleton('RoomService', RoomService);
	container.registerSingleton(RoomService);
	container.registerSingleton(ServerService);
	container.registerSingleton('StagingAreaService', StagingAreaService);
	container.registerSingleton(StagingAreaService);
	container.registerSingleton(WellKnownService);
	container.registerSingleton(SendJoinService);

	// Register queues
	container.registerSingleton('MissingEventsQueue', MissingEventsQueue);
	container.registerSingleton('StagingAreaQueue', StagingAreaQueue);

	// Register listeners
	container.registerSingleton('MissingEventListener', MissingEventListener);
	container.registerSingleton('StagingAreaListener', StagingAreaListener);

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
	container.resolve('StagingAreaListener');
	container.resolve('MissingEventListener');

	return container;
}
