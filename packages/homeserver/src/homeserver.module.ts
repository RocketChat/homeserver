import { Module } from "@nestjs/common";
import { PingController } from "./controllers/ping.controller";
import { ConfigService } from "./services/config.service";
import { LoggerService } from "./services/logger.service";

@Module({
	// imports: [QueueModule],
	providers: [
		// Core services
		ConfigService,
		LoggerService,
		// CONFIG_PROVIDER,
		// DatabaseConnection,
		// EventService,
		// MissingEventService,
		// StagingAreaService,

		// // Event processing services
		// EventAuthorizationService,
		// EventStateService,
		// FederationService,
		// NotificationService,
		// InviteService,
		// ProfilesService,
		// ServerService,
		// RoomService,
		// EventFetcherService,

		// // Repositories
		// EventRepository,
		// RoomRepository,
		// KeyRepository,
		// ServerRepository,

		// // Queues
		// MissingEventsQueue,
		// StagingAreaQueue,

		// // Listeners
		// MissingEventListener,
		// StagingAreaListener,

		// // Validation pipelines
		// DownloadedEventValidationPipeline,
		// SynchronousEventReceptionPipeline,

		// // Validators
		// EventFormatValidator,
		// EventHashesAndSignaturesValidator,
		// EventTypeSpecificValidator,
	],
	controllers: [
		PingController,
		// ProfilesController,
		// InviteController,
		// InviteControllerV1,
		// SendJoinController,
		// ServerController,
		// TransactionsController,
		// VersionsController,
		// WellKnownController,
		// InternalMessageController,
	],
	// exports: [ConfigService],
})
export class HomeserverModule {}
