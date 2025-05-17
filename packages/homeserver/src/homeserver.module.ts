import { FederationModule } from "@hs/federation-sdk";
import { Module } from "@nestjs/common";
import { InternalMessageController } from "./controllers/internal.controller";
import { InviteController } from "./controllers/invite.controller";
import { PingController } from "./controllers/ping.controller";
import { ProfilesController } from "./controllers/profiles.controller";
import { SendJoinController } from "./controllers/send-join.controller";
import { ServerController } from "./controllers/server.controller";
import { TransactionsController } from "./controllers/transactions.controller";
import { VersionsController } from "./controllers/versions.controller";
import { WellKnownController } from "./controllers/well-known.controller";
import { MissingEventsQueue } from "./queues/missing-event.queue";
import { QueueModule } from "./queues/queue.module";
import { StagingAreaQueue } from "./queues/staging-area.queue";
import { EventRepository } from "./repositories/event.repository";
import { KeyRepository } from "./repositories/key.repository";
import { RoomRepository } from "./repositories/room.repository";
import { ServerRepository } from "./repositories/server.repository";
import { ConfigService } from "./services/config.service";
import { DatabaseConnectionService } from "./services/database-connection.service";
import { EventAuthorizationService } from "./services/event-authorization.service";
import { EventFetcherService } from "./services/event-fetcher.service";
import { EventStateService } from "./services/event-state.service";
import { EventService } from "./services/event.service";
import { InviteService } from "./services/invite.service";
import { MissingEventService } from "./services/missing-event.service";
import { NotificationService } from "./services/notification.service";
import { ProfilesService } from "./services/profiles.service";
import { RoomService } from "./services/room.service";
import { ServerService } from "./services/server.service";
import { StagingAreaService } from "./services/staging-area.service";
import { WellKnownService } from "./services/well-known.service";
import { ClientRoomsController } from "./controllers/client/room.controller";
import { ClientRoomService } from "./services/client/room.service";

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
				const privateKeyBase64 = Buffer.from(signingKey.privateKey).toString('base64');
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

		// Client API services
		ClientRoomService,

		// Queues
		MissingEventsQueue,
		StagingAreaQueue,


		// Listeners
		// MissingEventListener,
		// StagingAreaListener,

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
		// Client API controllers
		ClientRoomsController,
	],
})
export class HomeserverModule {}
