import 'reflect-metadata';

import {
	type FederationModuleOptions,
	FederationRequestService,
} from '@hs/federation-sdk';
import { Emitter } from '@rocket.chat/emitter';
import { container } from 'tsyringe';
import { toUnpaddedBase64 } from './binaryData';
import { MissingEventListener } from './listeners/missing-event.listener';
import { StagingAreaListener } from './listeners/staging-area.listener';
import { MissingEventsQueue } from './queues/missing-event.queue';
import { StagingAreaQueue } from './queues/staging-area.queue';
import { EventRepository } from './repositories/event.repository';
import { KeyRepository } from './repositories/key.repository';
import { RoomRepository } from './repositories/room.repository';
import { ServerRepository } from './repositories/server.repository';
import { ConfigService } from './services/config.service';
import { DatabaseConnectionService } from './services/database-connection.service';
import { EventAuthorizationService } from './services/event-authorization.service';
import { EventFetcherService } from './services/event-fetcher.service';
import { EventStateService } from './services/event-state.service';
import { EventService } from './services/event.service';
import { EventEmitterService } from './services/event-emitter.service';
import { InviteService } from './services/invite.service';
import { MessageService } from './services/message.service';
import { MissingEventService } from './services/missing-event.service';
import { NotificationService } from './services/notification.service';
import { ProfilesService } from './services/profiles.service';
import { RoomService } from './services/room.service';
import { ServerService } from './services/server.service';
import { StagingAreaService } from './services/staging-area.service';
import { WellKnownService } from './services/well-known.service';
import { LockManagerService } from './utils/lock.decorator';
import type { HomeserverEventSignatures } from './types/events';

export interface HomeserverSetupOptions {
	emitter?: Emitter<HomeserverEventSignatures>;
}

export async function setup(options?: HomeserverSetupOptions) {
	const config = new ConfigService();
	const matrixConfig = config.getMatrixConfig();
	const serverConfig = config.getServerConfig();
	const signingKeys = await config.getSigningKey();
	const signingKey = signingKeys[0];

	container.register<FederationModuleOptions>('FEDERATION_OPTIONS', {
		useValue: {
			serverName: matrixConfig.serverName,
			signingKey: toUnpaddedBase64(signingKey.privateKey),
			signingKeyId: `ed25519:${signingKey.version}`,
			timeout: 30000,
			baseUrl: serverConfig.baseUrl,
		},
	});

	container.registerSingleton(FederationRequestService);
	container.registerSingleton(ConfigService);
	container.registerSingleton(DatabaseConnectionService);
	container.registerSingleton(EventAuthorizationService);
	container.registerSingleton(EventFetcherService);
	container.registerSingleton(EventStateService);
	container.registerSingleton(EventService);
	container.registerSingleton(EventEmitterService);
	container.registerSingleton(InviteService);
	container.registerSingleton(MessageService);
	container.registerSingleton(MissingEventService);
	container.registerSingleton(NotificationService);
	container.registerSingleton(ProfilesService);
	container.registerSingleton(RoomService);
	container.registerSingleton(ServerService);
	container.registerSingleton(StagingAreaService);
	container.registerSingleton(WellKnownService);
	container.registerSingleton(EventRepository);
	container.registerSingleton(KeyRepository);
	container.registerSingleton(RoomRepository);
	container.registerSingleton(ServerRepository);
	container.registerSingleton(MissingEventsQueue);
	container.registerSingleton(MissingEventListener);
	container.registerSingleton(StagingAreaQueue);
	container.registerSingleton(StagingAreaService);
	container.registerSingleton(StagingAreaListener);
	
	container.register(LockManagerService, {
		useFactory: () => new LockManagerService({ type: 'memory' })
		
		// NATS configuration example:
		// useFactory: () => new LockManagerService({
		// 	type: 'nats',
		// 	servers: ['nats://localhost:4222'],
		// 	timeout: 5000,
		// 	reconnect: true,
		// 	maxReconnectAttempts: 10
		// })
	});

	const eventEmitterService = container.resolve(EventEmitterService);
	if (options?.emitter) {
		eventEmitterService.setEmitter(options.emitter);
	} else {
		eventEmitterService.initializeStandalone();
	}

	container.resolve(StagingAreaListener);
	container.resolve(MissingEventListener);
}

