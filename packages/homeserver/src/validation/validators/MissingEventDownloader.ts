// import { EventFetcher } from '../../services/event-fetcher.service';
import { Logger } from '../../utils/logger';
import { Validator } from '../decorators/validator.decorator';
import { EventTypeArray, IPipeline } from '../pipelines';

const logger = new Logger("MissingEventDownloader");

class EventFetcher {
  constructor(context: any) {
    this.context = context;
  }
}

@Validator()
export class MissingEventDownloader implements IPipeline<EventTypeArray> {
  async validate(events: EventTypeArray, context: any): Promise<EventTypeArray> {
    const downloadedEvents: EventTypeArray = events;
    const eventFetcher = new EventFetcher(context);

    // roomState inicializada
    //    catar no banco -> missingEventsIds
    //    missingEventsIds -> tentando baixar
    //    processingQueue (eventos baixados) -> check_missing_events
    //    2 queues -> processingQueue -> roomState (in-memory / salva no Mongo)
    
    logger.debug(`Processing ${events.length} events`);

    for (const { eventId, event } of events) {
        if (!eventId) {
            logger.warn(`Skipping event with no eventId: ${JSON.stringify(event)}`);
            continue;
        }

        try {
            const authEventIds = this.extractEventIds(event.auth_events || []);
            const prevEventIds = this.extractEventIds(event.prev_events || []);
            const allDependencyIds = [...new Set([...authEventIds, ...prevEventIds])];
            
            if (allDependencyIds.length === 0) {
                logger.debug(`No dependencies to check for event ${eventId}`);
                continue;
            }
        
            const eventIdSet = new Set(events.map(e => e.eventId));
            const missingEventIds = allDependencyIds.filter(id => !eventIdSet.has(id));
            if (missingEventIds.length === 0) {
                logger.debug(`All dependencies for event ${eventId} are in the current batch`);
                continue;
            }

            logger.debug(`Fetching ${missingEventIds.length} missing dependencies for event ${eventId}`);
            const result = await eventFetcher.fetchEventsByIds(
                missingEventIds,
                event.room_id,
                event?.origin || context.config.name,
                context
            );

            if (result.missingEventIds.length > 0) {
                logger.warn(`Failed to fetch all dependencies for event ${eventId}`);
                throw new Error(`Failed to fetch all dependencies for event ${eventId}`);
            }
            
            logger.debug(`Successfully fetched all dependencies for event ${eventId}`);
        
            if (result.events.length > 0) {
                if (Array.isArray(downloadedEvents)) {
                    downloadedEvents.push(...result.events);
                }
            }
        } catch (error: any) {
            logger.error(`Error processing dependencies for ${eventId}: ${error.message || String(error)}`);
        }
    }
    
    return downloadedEvents;
  }

  private extractEventIds(events: any[]): string[] {
    return events.map(e => {
      if (typeof e === 'string') return e;
      if (Array.isArray(e) && e.length > 0) return e[0];
      return null;
    }).filter(Boolean) as string[];
  }
} 