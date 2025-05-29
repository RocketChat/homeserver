import { FederationModule } from '@hs/federation-sdk';
import { Module } from '@nestjs/common';
import { InviteController } from './controllers/federation/invite.controller';
import { ProfilesController } from './controllers/federation/profiles.controller';
import { SendJoinController } from './controllers/federation/send-join.controller';
import { TransactionsController } from './controllers/federation/transactions.controller';
import { VersionsController } from './controllers/federation/versions.controller';
import { InternalInviteController } from './controllers/internal/invite.controller';
import { InternalMessageController } from './controllers/internal/message.controller';
import { PingController } from './controllers/internal/ping.controller';
import { InternalRoomController } from './controllers/internal/room.controller';
import { ServerController } from './controllers/key/server.controller';
import { WellKnownController } from './controllers/well-known/well-known.controller';
import { MissingEventListener } from './listeners/missing-event.listener';
import { StagingAreaListener } from './listeners/staging-area.listener';
import { MissingEventsQueue } from './queues/missing-event.queue';
import { QueueModule } from './queues/queue.module';
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

// Create a ConfigModule to make ConfigService available to FederationModule
@Module({
	providers: [ConfigService],
	exports: [ConfigService],
})
export class ConfigModule {}

@Module({
	imports: [
		QueueModule,
		ConfigModule,
		FederationModule.forRootAsync({
			inject: [ConfigService],
			imports: [ConfigModule],
			useFactory: async (configService: ConfigService) => {
				const signingKeys = await configService.getSigningKey();
				const signingKey = signingKeys[0];
				const privateKeyBase64 = Buffer.from(signingKey.privateKey).toString(
					'base64',
				);
				return {
					serverName: configService.getMatrixConfig().serverName,
					signingKey: privateKeyBase64,
					signingKeyId: `ed25519:${signingKey.version}`,
					timeout: 30000,
				};
			},
		}),
	],
	providers: [
		// Core services
		// ConfigService,
		DatabaseConnectionService,
		EventService,
		StagingAreaService,
		MissingEventService,

		// Repositories
		EventRepository,
		RoomRepository,
		KeyRepository,
		ServerRepository,

		// Event processing services
		EventAuthorizationService,
		EventStateService,
		NotificationService,
		InviteService,
		ProfilesService,
		RoomService,
		EventFetcherService,
		WellKnownService,
		ServerService,
		MessageService,

		// Queues
		MissingEventsQueue,
		StagingAreaQueue,

		// Listeners
		MissingEventListener,
		StagingAreaListener,

		// Validation pipelines
		// DownloadedEventValidationPipeline,
		// SynchronousEventReceptionPipeline,

		// Validators
		// EventFormatValidator,
		// EventHashesAndSignaturesValidator,
		// EventTypeSpecificValidator,
	],
	controllers: [
		PingController,
		ProfilesController,
		InviteController,
		SendJoinController,
		ServerController,
		TransactionsController,
		VersionsController,
		WellKnownController,
		InternalMessageController,
		InternalRoomController,
		InternalInviteController,
	],
})
export class HomeserverModule {}
