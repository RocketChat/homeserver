import { Logger } from '../utils/logger';
import { EventTypeArray } from '../validation/pipelines';
import { RoomState } from './roomState';

const logger = new Logger("EventStagingArea");

export class EventStagingArea {
  private events: Map<string, any> = new Map();
  private pendingEvents: Map<string, any> = new Map();
  private processedEvents: Set<string> = new Set();
  private missingAuthEvents: Map<string, Set<string>> = new Map(); // event -> missing auth events
  private missingPrevEvents: Map<string, Set<string>> = new Map(); // event -> missing prev events
  
  private roomId: string;
  // private eventFetcher: EventFetcher;
  private roomState: RoomState;
  
  constructor(roomId: string, context: any) {
    this.roomId = roomId;
    // this.eventFetcher = new EventFetcher(context);
    this.roomState = new RoomState(roomId);
    logger.info(`EventStagingArea initialized for room ${roomId}`);
  }
  
  public async addEvents(events: EventTypeArray, context: any): Promise<void> {
    for (const { eventId, event } of events) {
      const roomId = event.room_id.split(':')[0];
      if (roomId !== this.roomId) {
        logger.warn(`Ignoring event from wrong room: ${eventId}`);
        continue;
      }
      
      this.events.set(eventId, event);
      this.pendingEvents.set(eventId, event);
    }
    
    await this.processEvents(context);
  }
  
  private async processEvents(context: any): Promise<void> {
    const pendingEventIds = Array.from(this.pendingEvents.keys());
    logger.debug(`Processing ${pendingEventIds.length} pending events`);
    
    for (const eventId of pendingEventIds) {
      const event = this.pendingEvents.get(eventId);
      if (!event) continue;
      
      const authEventIds = this.getAuthEventIds(event);
      const missingAuthEventIds = this.getMissingEventIds(authEventIds);
      if (missingAuthEventIds.length > 0) {
        this.missingAuthEvents.set(eventId, new Set(missingAuthEventIds));
      }
      
      const prevEventIds = this.getPrevEventIds(event);
      const missingPrevEventIds = this.getMissingEventIds(prevEventIds);
      if (missingPrevEventIds.length > 0) {
        this.missingPrevEvents.set(eventId, new Set(missingPrevEventIds));
      }

      this.processedEvents.add(eventId);
    }
    
    await this.moveEventsToRoomState();
  }
  
  private async moveEventsToRoomState(): Promise<void> {
    const readyEvents: any[] = [];
    
    for (const [eventId, event] of this.pendingEvents.entries()) {
      if (
        this.missingAuthEvents.has(eventId) || 
        this.missingPrevEvents.has(eventId)
      ) {
        continue;
      }
      
      readyEvents.push(event);
      this.pendingEvents.delete(eventId);
    }
    
    readyEvents.sort((a, b) => {
      const depthA = a.depth || 0;
      const depthB = b.depth || 0;
      return depthA - depthB;
    });
    
    for (const event of readyEvents) {
      await this.roomState.addEvent(event);
      logger.debug(`Added event ${event.event_id} to room state`);
    }
    
    logger.info(`Moved ${readyEvents.length} events to room state`);
  }
  
  private getMissingEventIds(eventIds: string[]): string[] {
    return eventIds.filter(id => 
      !this.events.has(id) && 
      !this.roomState.getEvent(id)
    );
  }
  
  private getAuthEventIds(event: any): string[] {
    if (!event.auth_events || !Array.isArray(event.auth_events)) {
      return [];
    }
    
    return event.auth_events.map((authEvent: any) => 
      Array.isArray(authEvent) ? authEvent[0] : authEvent
    );
  }
  
  private getPrevEventIds(event: any): string[] {
    if (!event.prev_events || !Array.isArray(event.prev_events)) {
      return [];
    }
    
    return event.prev_events.map((prevEvent: any) => 
      Array.isArray(prevEvent) ? prevEvent[0] : prevEvent
    );
  }
  
  public getAllEvents(): any[] {
    return Array.from(this.events.values());
  }
  
  public getPendingEvents(): any[] {
    return Array.from(this.pendingEvents.values());
  }
  
  public getRoomState(): RoomState {
    return this.roomState;
  }
  
  public getStats(): Record<string, number> {
    return {
      totalEvents: this.events.size,
      pendingEvents: this.pendingEvents.size,
      processedEvents: this.processedEvents.size,
      eventsWithMissingAuthDeps: this.missingAuthEvents.size,
      eventsWithMissingPrevDeps: this.missingPrevEvents.size
    };
  }
} 