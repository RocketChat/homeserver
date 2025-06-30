import 'reflect-metadata';

import { swagger } from '@elysiajs/swagger';
import {
	type FederationModuleOptions,
	FederationRequestService,
} from '@hs/federation-sdk';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { toUnpaddedBase64 } from './binaryData';
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
import { MissingEventListener } from './listeners/missing-event.listener';
import { StagingAreaListener } from './listeners/staging-area.listener';
import { MissingEventsQueue } from '@hs/federation-sdk/src/queues/missing-event.queue';
import { StagingAreaQueue } from '@hs/federation-sdk/src/queues/staging-area.queue';
import { EventRepository } from './repositories/event.repository';
import { KeyRepository } from './repositories/key.repository';
import { RoomRepository } from './repositories/room.repository';
import { ServerRepository } from './repositories/server.repository';
import { StateRepository } from './repositories/state.repository';
import { ConfigService } from '@hs/federation-sdk/src/services/config.service';
import { DatabaseConnectionService } from '@hs/federation-sdk/src/services/database-connection.service';
import { EventAuthorizationService } from '@hs/federation-sdk/src/services/event-authorization.service';
import { EventFetcherService } from '@hs/federation-sdk/src/services/event-fetcher.service';
import { EventStateService } from '@hs/federation-sdk/src/services/event-state.service';
import { EventService } from '@hs/federation-sdk/src/services/event.service';
import { InviteService } from '@hs/federation-sdk/src/services/invite.service';
import { MessageService } from '@hs/federation-sdk/src/services/message.service';
import { MissingEventService } from '@hs/federation-sdk/src/services/missing-event.service';
import { NotificationService } from '@hs/federation-sdk/src/services/notification.service';
import { ProfilesService } from '@hs/federation-sdk/src/services/profiles.service';
import { RoomService } from '@hs/federation-sdk/src/services/room.service';
import { ServerService } from '@hs/federation-sdk/src/services/server.service';
import { StateService } from '@hs/federation-sdk/src/services/state.service';
import { StagingAreaService } from '@hs/federation-sdk/src/services/staging-area.service';
import { WellKnownService } from '@hs/federation-sdk/src/services/well-known.service';
import { LockManagerService } from '@hs/federation-sdk/src/utils/lock.decorator';
import { StateEventRepository } from './repositories/state-event.repository';
import { roomPlugin } from './controllers/federation/rooms.controller';

let app: Elysia;

async function setup() {
	// Load config and signing key
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

	// Register services and repositories with tsyringe
	container.registerSingleton(ConfigService);
	container.registerSingleton(DatabaseConnectionService);
	container.registerSingleton(StateRepository);
	container.registerSingleton(StateService);
	container.registerSingleton(EventAuthorizationService);
	container.registerSingleton(EventFetcherService);
	container.registerSingleton(EventStateService);
	container.registerSingleton(EventService);
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
	container.registerSingleton(StateEventRepository);

	// Register the lock manager service with configuration
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

	// Resolve the listeners to ensure they are registered and ready to use
	container.resolve(StagingAreaListener);
	container.resolve(MissingEventListener);

	app = new Elysia();

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
