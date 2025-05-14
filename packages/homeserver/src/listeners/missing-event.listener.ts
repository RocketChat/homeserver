import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { MissingEventsQueue, MissingEventType } from '../queues/missing-event.queue';
import { StagingAreaQueue } from '../queues/staging-area.queue';
import { ConfigService } from '../services/config.service';
import { EventFetcherService, FetchedEvents } from '../services/event-fetcher.service';
import { EventService } from '../services/event.service';
import { StagingAreaService } from '../services/staging-area.service';
import { Logger } from '../utils/logger';

@Injectable()
export class MissingEventListener {
  private readonly logger = new Logger('MissingEventListener');
  private readonly seenEvents = new Set<string>();
  
  constructor(
    @Inject(forwardRef(() => MissingEventsQueue)) private readonly missingEventsQueue: MissingEventsQueue,
    @Inject(forwardRef(() => StagingAreaQueue)) private readonly stagingAreaQueue: StagingAreaQueue,
    @Inject(forwardRef(() => StagingAreaService)) private readonly stagingAreaService: StagingAreaService,
    @Inject(EventService) private readonly eventService: EventService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(EventFetcherService) private readonly eventFetcherService: EventFetcherService
  ) {
    this.missingEventsQueue.registerHandler(this.handleQueueItem.bind(this));
  }

  async handleQueueItem(data: MissingEventType) {
    this.logger.debug(`Handling missing event ${data.eventId} from ${data.origin}`);
    this.logger.debug(`Data: ${JSON.stringify(data)}`);
    const { eventId, roomId, origin } = data;
    
    if (this.seenEvents.has(eventId)) {
      this.logger.debug(`Already attempted to fetch event ${eventId}, skipping`);
      return;
    }
    
    this.seenEvents.add(eventId);
    this.logger.debug(`Fetching missing event ${eventId} from ${origin} for room ${roomId}`);
    
    try {
      const fetchedEvents: FetchedEvents = await this.eventFetcherService.fetchEventsByIds(
        [eventId], 
        roomId, 
        origin
      );
      
      if (fetchedEvents.events.length === 0) {
        this.logger.warn(`Failed to fetch missing event ${eventId} from ${origin}`);
        return;
      }
      
      // Process fetched events directly without validation pipeline
      // We'll use the standard event processing flow instead
      let addedCount = 0;
      for (const eventData of fetchedEvents.events) {
        const event = eventData.event;
        
        // Add the event to the staging area for processing
        // It will go through normal validation there
        this.stagingAreaService.addEventToQueue({
          eventId: event.event_id || eventData.eventId,
          roomId: event.room_id,
          origin: event.origin || origin,
          event
        });
        
        addedCount++;
      }
      
      this.logger.debug(`Added ${addedCount} fetched events to processing queue`);
      
      if (fetchedEvents.missingEventIds.length > 0) {
        this.logger.debug(`Still missing ${fetchedEvents.missingEventIds.length} referenced events`);
        
        for (const missingId of fetchedEvents.missingEventIds) {
          this.missingEventsQueue.enqueue({
            eventId: missingId,
            roomId,
            origin
          });
        }
      }
    } catch (error: any) {
      this.logger.error(`Error fetching missing event ${eventId}: ${error?.message || String(error)}`);
    }
  }
}