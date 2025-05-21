import { EventStagingArea } from "../../events/EventStagingArea";
import type { StagingEvent } from "../../events/stagingArea";
import { Pipeline } from "../decorators/pipeline.decorator";
// import {
//   EventAuthChainValidator,
//   MissingEventDownloader,
//   RoomStateValidator
// } from "../validators";
import { type EventTypeArray, type IPipeline, SequentialPipeline } from "./index";

/**
 * Validates and processes events through a staging area
 * 
 * This pipeline:
 * 1. Downloads any missing events referenced by the incoming events
 * 2. Validates event auth chains against Matrix rules
 * 3. Validates events against the room's current state
 * 4. Processes events into room-specific staging areas
 * 5. Saves validated events to the database
 */
@Pipeline()
export class StagingAreaPipeline {
  private validationPipeline: IPipeline<EventTypeArray>;
  private stagingAreas: Map<string, EventStagingArea> = new Map();

  constructor() {
    this.validationPipeline = this.createValidationPipeline();
  }

  private createValidationPipeline(): IPipeline<EventTypeArray> {
    return new SequentialPipeline<EventTypeArray>()
      // .add(new MissingEventDownloader())
      // .add(new EventAuthChainValidator())
      // .add(new RoomStateValidator());
  }

  async validate(events: EventTypeArray, context: any): Promise<void> {
    // if (!events || events.length === 0) {
    //   console.warn("No events to validate");
    //   return [];
    // }

    // console.debug(`Validating ${events.length} events in staging area pipeline`);
    
    // const validatedEvents = await this.validationPipeline.validate(events, context);
    // const successfulEvents = validatedEvents.filter(e => !e.error);
    
    // if (successfulEvents.length > 0) {
    //   const eventsByRoom = this.groupEventsByRoom(successfulEvents);
    //   for (const [roomId, roomEvents] of Object.entries(eventsByRoom)) {
    //     await this.processRoomEvents(roomId, roomEvents, context);
    //   }
    //   await this.saveValidatedEvents(successfulEvents.map(e => e.event), context);
    // }
    
    // return validatedEvents;
  }
  
  private groupEventsByRoom(events: EventTypeArray): Record<string, EventTypeArray> {
    const eventsByRoom: Record<string, EventTypeArray> = {};
    
    for (const { eventId, event } of events) {
      const parts = event.room_id.split(':');
      const roomId = parts[0];
      
      if (!roomId) continue;
      
      if (!eventsByRoom[roomId]) {
        eventsByRoom[roomId] = [];
      }
      
      eventsByRoom[roomId].push({ eventId, event });
    }
    
    return eventsByRoom;
  }
  
  private async processRoomEvents(roomId: string, events: EventTypeArray, context: any): Promise<void> {
    let stagingArea = this.stagingAreas.get(roomId);
    if (!stagingArea) {
      stagingArea = new EventStagingArea(roomId, context);
      this.stagingAreas.set(roomId, stagingArea);
      console.debug(`Created new staging area for room ${roomId}`);
    }
    
    await stagingArea.addEvents(events, context);
    const stats = stagingArea.getStats();
    console.debug(`Staging area for room ${roomId}: ${JSON.stringify(stats)}`);
  }

  async saveValidatedEvents(events: any[], context: any) {
    if (!context.mongo?.createEvent) {
      console.warn('No createEvent function provided');
      return;
    }

    console.debug(`Saving ${events.length} validated events to database`);
    for (const event of events) {
      try {
        await context.mongo.createEvent(event);
        console.debug(`Saved event: ${event.event_id || 'unknown'}`);
      } catch (error) {
        console.error(`Failed to save validated event: ${error}`);
      }
    }
  }
  
  public getRoomState(roomId: string): any | null {
    const stagingArea = this.stagingAreas.get(roomId);
    if (!stagingArea) return null;
    
    return stagingArea.getRoomState();
  }
  
  public async downloadAndProcessEvents(events: StagingEvent[], context: any): Promise<{ 
    downloadedEvents: { eventId: string, event: any }[] 
  }> {
    // const processedEvents = await this.validate(events, context);
    // const successfulEvents = processedEvents.filter(e => !e.error);
    // if (successfulEvents.length > 0) {
    //   console.info(`Processing ${successfulEvents.length} downloaded events`);
    //   await this.saveValidatedEvents(successfulEvents.map(e => e.event), context);
    // }
    
    return {
      downloadedEvents: []
    };
  }
} 