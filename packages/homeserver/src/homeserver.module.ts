import { Module } from "@nestjs/common";
import { InternalMessageController } from "./controllers/internal.controller";
import { InviteController, InviteControllerV1 } from "./controllers/invite.controller";
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
import { FederationService } from "./services/federation.service";
import { InviteService } from "./services/invite.service";
import { LoggerService } from "./services/logger.service";
import { MissingEventService } from "./services/missing-event.service";
import { NotificationService } from "./services/notification.service";
import { ProfilesService } from "./services/profiles.service";
import { RoomService } from "./services/room.service";
import { ServerService } from "./services/server.service";
import { StagingAreaService } from "./services/staging-area.service";
import { WellKnownService } from "./services/well-known.service";

@Module({
	imports: [QueueModule],
	providers: [
		// Core services
		ConfigService,
		LoggerService,
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
		FederationService,
		NotificationService,
		InviteService,
		ProfilesService,
		RoomService,
		EventFetcherService,
		WellKnownService,
		ServerService,

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
		InviteControllerV1,
		SendJoinController,
		ServerController,
		TransactionsController,
		VersionsController,
		WellKnownController,
		InternalMessageController,
	],
})
export class HomeserverModule {}
