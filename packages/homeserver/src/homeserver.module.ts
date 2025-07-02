import 'reflect-metadata';

import {
	ConfigService,
	EventRepository,
	type FederationModuleOptions,
	FederationRequestService,
	FederationService,
	type HomeserverEventSignatures,
	KeyRepository,
	RoomRepository,
	ServerRepository,
	StateEventRepository,
	StateRepository,
} from '@hs/federation-sdk';

import { swagger } from '@elysiajs/swagger';
import { toUnpaddedBase64 } from '@hs/core';
import { MissingEventListener } from '@hs/federation-sdk';
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
import { LockManagerService } from '@hs/federation-sdk';
import { Emitter } from '@rocket.chat/emitter';
import Elysia from 'elysia';
import { container } from 'tsyringe';
import { invitePlugin } from './controllers/federation/invite.controller';
import { profilesPlugin } from './controllers/federation/profiles.controller';
import { roomPlugin } from './controllers/federation/rooms.controller';
import { sendJoinPlugin } from './controllers/federation/send-join.controller';
import { transactionsPlugin } from './controllers/federation/transactions.controller';
import { versionsPlugin } from './controllers/federation/versions.controller';
import { internalInvitePlugin } from './controllers/internal/invite.controller';
import { internalMessagePlugin } from './controllers/internal/message.controller';
import { pingPlugin } from './controllers/internal/ping.controller';
import { internalRoomPlugin } from './controllers/internal/room.controller';
import { serverKeyPlugin } from './controllers/key/server.controller';
import { wellKnownPlugin } from './controllers/well-known/well-known.controller';
import { StagingAreaListener } from './listeners/staging-area.listener';

import { MissingEventsQueue } from '@hs/federation-sdk';
import { StagingAreaQueue } from '@hs/federation-sdk';

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
	container.registerSingleton('ConfigService', ConfigService);
	container.registerSingleton(
		'DatabaseConnectionService',
		DatabaseConnectionService,
	);
	container.registerSingleton('StateRepository', StateRepository);
	container.registerSingleton(StateService);
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
	container.registerSingleton(RoomService);
	container.registerSingleton('RoomService', RoomService);
	container.registerSingleton(ServerService);
	container.registerSingleton(StagingAreaService);
	container.registerSingleton('StagingAreaService', StagingAreaService);
	container.registerSingleton(WellKnownService);
	container.registerSingleton('EventRepository', EventRepository);
	container.registerSingleton('KeyRepository', KeyRepository);
	container.registerSingleton('RoomRepository', RoomRepository);
	container.registerSingleton('ServerRepository', ServerRepository);
	container.registerSingleton('StateRepository', StateRepository);
	container.registerSingleton('StateEventRepository', StateEventRepository);
	container.registerSingleton('MissingEventsQueue', MissingEventsQueue);
	container.registerSingleton('StagingAreaQueue', StagingAreaQueue);
	container.registerSingleton(MissingEventListener);
	container.registerSingleton(StagingAreaListener);
	container.registerSingleton('FederationService', FederationService);

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
