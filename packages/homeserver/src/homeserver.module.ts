import 'reflect-metadata';

import {
	ConfigService,
	type FederationModuleOptions,
	FederationRequestService,
} from '@hs/federation-sdk';
import Elysia from 'elysia';
import { Emitter } from '@rocket.chat/emitter';
import { swagger } from '@elysiajs/swagger';
import { container } from 'tsyringe';
import { toUnpaddedBase64 } from '@hs/core';
import { invitePlugin } from './controllers/federation/invite.controller';
import { profilesPlugin } from './controllers/federation/profiles.controller';
import { sendJoinPlugin } from './controllers/federation/send-join.controller';
import { transactionsPlugin } from './controllers/federation/transactions.controller';
import { versionsPlugin } from './controllers/federation/versions.controller';
import { internalInvitePlugin } from './controllers/internal/invite.controller';
import { internalMessagePlugin } from './controllers/internal/message.controller';
import { pingPlugin } from './controllers/internal/ping.controller';
import { internalRoomPlugin } from './controllers/internal/room.controller';
import { serverKeyPlugin } from './controllers/key/server.controller';
import { wellKnownPlugin } from './controllers/well-known/well-known.controller';
import { roomPlugin } from './controllers/federation/rooms.controller';
import { MissingEventListener } from '@hs/federation-sdk';
import { StagingAreaListener } from './listeners/staging-area.listener';
import { MissingEventsQueue } from './queues/missing-event.queue';
import { StagingAreaQueue } from './queues/staging-area.queue';
import { DatabaseConnectionService } from '@hs/federation-sdk';
import { EventAuthorizationService } from '@hs/federation-sdk';
import { EventFetcherService } from '@hs/federation-sdk';
import { EventStateService } from '@hs/federation-sdk';
import { EventService } from '@hs/federation-sdk';
import { EventEmitterService } from '@hs/federation-sdk';
import { InviteService } from '@hs/federation-sdk';
import { MessageService } from '@hs/federation-sdk';
import { MissingEventService } from '@hs/federation-sdk';
import { NotificationService } from '@hs/federation-sdk';
import { ProfilesService } from '@hs/federation-sdk';
import { RoomService } from '@hs/federation-sdk';
import { ServerService } from '@hs/federation-sdk';
import { StateService } from '@hs/federation-sdk';
import { StagingAreaService } from '@hs/federation-sdk';
import { WellKnownService } from '@hs/federation-sdk';
import { LockManagerService } from './utils/lock.decorator';
import type { HomeserverEventSignatures } from './types/events';
import { StateEventRepository } from '@hs/federation-sdk';
import { EventRepository } from '@hs/federation-sdk';
import { KeyRepository } from '@hs/federation-sdk';
import { RoomRepository } from '@hs/federation-sdk';
import { ServerRepository } from '@hs/federation-sdk';
import { StateRepository } from '@hs/federation-sdk';

export type { HomeserverEventSignatures };
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
	container.registerSingleton(StateRepository);
	container.registerSingleton(StateService);
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
	container.registerSingleton('RoomService', RoomService);
	container.registerSingleton(ServerService);
	container.registerSingleton(StagingAreaService);
	container.registerSingleton('StagingAreaService', StagingAreaService);
	container.registerSingleton(WellKnownService);
	container.registerSingleton('IEventRepository', EventRepository);
	container.registerSingleton(KeyRepository);
	container.registerSingleton(RoomRepository);
	container.registerSingleton(ServerRepository);
	container.registerSingleton(MissingEventsQueue);
	container.registerSingleton(MissingEventListener);
	container.registerSingleton(StagingAreaQueue);
	container.registerSingleton(StagingAreaService);
	container.registerSingleton(StateEventRepository);

	// Register the lock manager service with configuration
	container.registerSingleton(StagingAreaListener);

	container.register(LockManagerService, {
		useFactory: () => new LockManagerService({ type: 'memory' }),

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

	const app = new Elysia();

	app
		.use(
			// @ts-ignore - Elysia is not typed correctly
			swagger({
				documentation: {
					info: {
						title: 'Matrix Homeserver API',
						version: '1.0.0',
						description:
							'Matrix Protocol Implementation - Federation and Internal APIs',
					},
				},
			}),
		)
		.use(invitePlugin)
		.use(profilesPlugin)
		.use(sendJoinPlugin)
		.use(transactionsPlugin)
		.use(versionsPlugin)
		.use(internalInvitePlugin)
		.use(internalMessagePlugin)
		.use(pingPlugin)
		.use(internalRoomPlugin)
		.use(serverKeyPlugin)
		.use(wellKnownPlugin)
		.use(roomPlugin);

	return app;
}

export const appPromise = setup();

// TODO: Register plugins/handlers for controllers here
// e.g. app.use(profilesPlugin)

// Export app for use in main entry point
