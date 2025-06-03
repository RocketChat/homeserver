import 'reflect-metadata';

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
import { InviteService } from './services/invite.service';
import { MessageService } from './services/message.service';
import { MissingEventService } from './services/missing-event.service';
import { NotificationService } from './services/notification.service';
import { ProfilesService } from './services/profiles.service';
import { RoomService } from './services/room.service';
import { ServerService } from './services/server.service';
import { StagingAreaService } from './services/staging-area.service';
import { WellKnownService } from './services/well-known.service';

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

	// Resolve the listeners to ensure they are registered and ready to use
	// without relying on lazy injection
	container.resolve(MissingEventListener);
	container.resolve(StagingAreaService);

	// Set up Elysia app instance
	app = new Elysia();

	app
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
		.use(wellKnownPlugin);

	return app;
}

export const appPromise = setup();

// TODO: Register plugins/handlers for controllers here
// e.g. app.use(profilesPlugin)

// Export app for use in main entry point
