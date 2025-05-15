import { Injectable } from '@nestjs/common';
import { FederationClient } from '../../../federation-sdk/src';
import { generateId } from '../authentication';
import { EventRepository } from '../repositories/event.repository';
import { ConfigService } from './config.service';
import { LoggerService } from './logger.service';

export interface FetchedEvents {
  events: any[];
  missingEventIds: string[];
}

@Injectable()
export class EventFetcherService {
  private readonly logger: LoggerService;
  private federationClient: FederationClient | null = null;
  
  constructor(
    private readonly configService: ConfigService,
    private readonly eventRepository: EventRepository,
    private readonly loggerService: LoggerService
  ) {
    this.logger = this.loggerService.setContext('EventFetcherService');
    
    // Initialize the federation client
    this.initFederationClient().catch(err => {
      this.logger.error(`Failed to initialize federation client: ${err.message}`);
    });
  }
  
  private async initFederationClient(): Promise<void> {
    try {
      const signingKeys = await this.configService.getSigningKey();
      const signingKey = Array.isArray(signingKeys) ? signingKeys[0] : signingKeys;

      this.federationClient = new FederationClient({
        serverName: this.configService.getServerConfig().name,
        signingKey,
        debug: true
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize federation client: ${errorMessage}`);
      throw error;
    }
  }
  
  public async fetchEventsByIds(
    eventIds: string[], 
    roomId: string, 
    originServer: string, 
  ): Promise<FetchedEvents> {
    this.logger.debug(`Fetching ${eventIds.length} events for room ${roomId}`);

    if (!eventIds || eventIds.length === 0) {
      return { events: [], missingEventIds: [] };
    }
    
    if (!this.federationClient) {
      await this.initFederationClient();
    }
    
    // Try to get events from local database
    const localEvents: { eventId: string, event: any }[] = [];
    const dbEvents = await this.eventRepository.find({ _id: { $in: eventIds } }, {});
    
    localEvents.push(...dbEvents.map(({ _id, event }) => ({ eventId: _id, event })));
    this.logger.debug(`Found ${localEvents.length} events in local database`);
    
    if (localEvents.length === eventIds.length) {
      return { 
        events: localEvents, 
        missingEventIds: [] 
      };
    }
    
    // For events we don't have locally, try federation
    const missingEventIds = eventIds.filter(id => !localEvents.some(e => e.eventId === id));
    if (missingEventIds.length > 0) {
      this.logger.debug(`Fetching ${missingEventIds.length} missing events from federation ${ Array.from(missingEventIds).join(', ') } ${originServer}`);
      const federationEvents = await this.fetchEventsFromFederation(
        missingEventIds, 
        originServer
      );

      const federationEventsWithIds = federationEvents.map(e => ({ eventId: e.event_id || generateId(e), event: e }));

      return {
        events: [...localEvents, ...federationEventsWithIds],
        missingEventIds: missingEventIds.filter(id => 
          !federationEventsWithIds.some(e => e.eventId === id)
        )
      };
    }
    
    return {
      events: localEvents,
      missingEventIds: []
    };
  }
  
  public async fetchAuthEventsByTypes(
    missingTypes: string[], 
    roomId: string, 
  ): Promise<Record<string, any>> {
    const results: Record<string, any> = {};
    
    try {
      // Find auth events of the required types in the room
      const authEvents = await this.eventRepository.find(
        {
          'event.room_id': roomId,
          'event.type': { $in: missingTypes }
        },
        {}
      );
      
      // Group events by type
      return authEvents.reduce((acc, event) => {
        if (event.event.type) {
          if (!acc[event.event.type]) {
            acc[event.event.type] = [];
          }
          acc[event.event.type].push(event.event);
        }
        return acc;
      }, {} as Record<string, any[]>);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error fetching auth events by type: ${errorMessage}`);
      return results;
    }
  }
  
  private async fetchEventsFromFederation(
    eventIds: string[], 
    targetServerName: string
  ): Promise<any[]> {
    if (!this.federationClient) {
      await this.initFederationClient();
    }

    const eventsToReturn: any[] = [];
    
    try {
      // TODO: Improve batch event requests to avoid too many parallel requests
      const chunks = this.chunkArray(eventIds, 10);
      
      for (const chunk of chunks) {
        if (targetServerName === 'rc1') {
          this.logger.log('Skipping rc1');
          return [];
        }

        const federationResponses = await Promise.all(
          chunk.map(id => this.federationClient!.getEvent(targetServerName, id))
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
      this.logger.error(`Error fetching events from federation: ${errorMessage}`);
      this.logger.debug(`Failed federation request details: ${JSON.stringify({eventIds, targetServerName})}`);
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