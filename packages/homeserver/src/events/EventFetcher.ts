import { FederationClient } from '../../../federation-sdk/src';
import { generateId } from '../authentication';
import { Logger } from '../utils/logger';

const logger = new Logger("EventFetcher");

export interface FetchedEvents {
  events: any[];
  missingEventIds: string[];
}

export class EventFetcher {
  private federationClient: FederationClient;
  
  constructor(context: any) {
    this.federationClient = new FederationClient({
      serverName: context.config.name,
      signingKey: Array.isArray(context.config.signingKey) ? 
        context.config.signingKey[0] : context.config.signingKey,
      debug: context.config.debug
    });
  }
  
  public async fetchEventsByIds(
    eventIds: string[], 
    roomId: string, 
    originServer: string, 
    context: any
  ): Promise<FetchedEvents> {
    if (!eventIds || eventIds.length === 0) {
      return { events: [], missingEventIds: [] };
    }
    
    logger.debug(`Fetching ${eventIds.length} events for room ${roomId}`);
    
    // Try to get events from local database
    const localEvents: { eventId: string, event: any }[] = [];
    if (context.mongo?.getEventsByIds) {
      const dbEvents = await context.mongo.getEventsByIds(eventIds);
      localEvents.push(...dbEvents.map(({ _id, event }: { _id: string, event: any }) => ({ eventId: _id, event })));
      logger.debug(`Found ${Object.keys(localEvents).length} events in local database`);
      if (Object.keys(localEvents).length === eventIds.length) {
        return { 
          events: Object.values(localEvents), 
          missingEventIds: [] 
        };
      }
    }
    
    // For events we don't have locally, try federation
    const missingEventIds = eventIds.filter((id: string) => !localEvents.some((e: any) => e.eventId === id));
    if (missingEventIds.length > 0) {
      logger.debug(`Fetching ${missingEventIds.length} missing events from federation ${ Array.from(missingEventIds).join(', ') } ${originServer}`);
      const federationEvents = await this.fetchEventsFromFederation(
        missingEventIds, 
        originServer
      );

      const federationEventsWithIds = federationEvents.map(e => ({ eventId: e.event_id || generateId(e), event: e }));

      return {
        events: [...Object.values(localEvents), ...federationEventsWithIds],
        missingEventIds: missingEventIds.filter(id => 
          !federationEventsWithIds.some(e => e.eventId === id)
        )
      };
    }
    
    return {
      events: Object.values(localEvents),
      missingEventIds: []
    };
  }
  
  public async fetchAuthEventsByTypes(
    missingTypes: string[], 
    roomId: string, 
    context: any
  ): Promise<Record<string, any>> {
    const results: Record<string, any> = {};
    
    if (!context.mongo?.getAuthEventsByType) {
      return results;
    }
    
    try {
      return await context.mongo.getAuthEventsByType(missingTypes, roomId);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error fetching auth events by type: ${errorMessage}`);
      return results;
    }
  }
  
  private async fetchEventsFromFederation(
    eventIds: string[], 
    targetServerName: string
  ): Promise<any[]> {
    const eventsToReturn: any[] = [];
    
    try {
      // TODO: Improve batch event requests to avoid too many parallel requests
      const chunks = this.chunkArray(eventIds, 10);
      
      for (const chunk of chunks) {
        if (targetServerName === 'rc1') {
          logger.info('Skipping rc1');
          return [];
        }

        const federationResponses = await Promise.all(
          chunk.map(id => this.federationClient.getEvent(targetServerName, id))
        );
        
        for (const response of federationResponses) {
          if (response.pdus && response.pdus.length > 0) {
            eventsToReturn.push(...response.pdus);
          }
        }
      }
      
      return eventsToReturn;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error fetching events from federation: ${errorMessage}`);
      console.log({eventIds, targetServerName})
      return eventsToReturn;
    }
  }
  
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
} 