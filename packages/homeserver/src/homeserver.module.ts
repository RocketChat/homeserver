import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { InviteController, InviteControllerV1 } from './controllers/invite.controller';
import { PingController } from './controllers/ping.controller';
import { ProfilesController } from './controllers/profiles.controller';
import { SendJoinController } from './controllers/send-join.controller';
import { ServerController } from './controllers/server.controller';
import { TransactionsController } from './controllers/transactions.controller';
import { VersionsController } from './controllers/versions.controller';
import { WellKnownController } from './controllers/well-known.controller';
import { DatabaseConnection } from './database/database.connection';
import { MissingEventListener } from './listeners/missing-event.listener';
import { StagingAreaListener } from './listeners/staging-area.listener';
import { HttpLoggerMiddleware } from './middleware/http-logger.middleware';
import { MissingEventsQueue } from './queues/missing-event.queue';
import { QueueModule } from './queues/queue.module';
import { StagingAreaQueue } from './queues/staging-area.queue';
import { EventRepository } from './repositories/event.repository';
import { KeyRepository } from './repositories/key.repository';
import { RoomRepository } from './repositories/room.repository';
import { ServerRepository } from './repositories/server.repository';
import { ConfigService } from './services/config.service';
import { EventAuthorizationService } from './services/event-authorization.service';
import { EventFetcherService } from './services/event-fetcher.service';
import { EventStateService } from './services/event-state.service';
import { EventService } from './services/event.service';
import { FederationService } from './services/federation.service';
import { InviteService } from './services/invite.service';
import { MissingEventService } from './services/missing-event.service';
import { NotificationService } from './services/notification.service';
import { ProfilesService } from './services/profiles.service';
import { RoomService } from './services/room.service';
import { ServerService } from './services/server.service';
import { StagingAreaService } from './services/staging-area.service';
import { DownloadedEventValidationPipeline } from './validation/pipelines/DownloadedEventValidationPipeline';
import { SynchronousEventReceptionPipeline } from './validation/pipelines/synchronousEventReceptionPipeline';
import { EventFormatValidator } from './validation/validators/EventFormatValidator';
import { EventHashesAndSignaturesValidator } from './validation/validators/EventHashesAndSignaturesValidator';
import { EventTypeSpecificValidator } from './validation/validators/EventTypeSpecificValidator';
import { KeyService } from './services/key.service';
import { AuthHeaderMiddleware } from './middleware/auth-header.middleware';

const CONFIG_PROVIDER = {
  provide: ConfigService,
  useFactory: () => new ConfigService(),
};

@Module({
  imports: [
    QueueModule
  ],
  providers: [
    // Core services
    CONFIG_PROVIDER,
    DatabaseConnection,
    EventService,
    MissingEventService,
    StagingAreaService,
    
    // Event processing services
    EventAuthorizationService,
    EventStateService,
    FederationService,
    NotificationService,
    InviteService,
    ProfilesService,
    ServerService,
    RoomService,
    EventFetcherService,
	KeyService,
    
    // Repositories
    EventRepository,
    RoomRepository,
    KeyRepository,
    ServerRepository,
    
    // Queues
    MissingEventsQueue,
    StagingAreaQueue,
    
    // Listeners
    MissingEventListener,
    StagingAreaListener,
    
    // Validation pipelines
    DownloadedEventValidationPipeline,
    SynchronousEventReceptionPipeline,
    
    // Validators
    EventFormatValidator,
    EventHashesAndSignaturesValidator,
    EventTypeSpecificValidator,
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
  ],
  exports: [ConfigService],
})
export class HomeserverModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(HttpLoggerMiddleware)
      .forRoutes('*');

    consumer
      .apply(AuthHeaderMiddleware)
      .forRoutes('/_matrix/federation/*');
  }
}