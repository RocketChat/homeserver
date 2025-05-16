import { RoomState } from "../../events/roomState";
import type { EventType, EventTypeArray, IPipeline } from "../pipelines";

/**
 * Validates events against room state to ensure they comply with Matrix protocol rules
 * 
 * This validator ensures that:
 * 1. Events are associated with valid rooms
 * 2. Events comply with the current state of their rooms
 * 3. Events can be properly applied to their room state
 */
export class RoomStateValidator implements IPipeline<EventTypeArray> {
  private roomStates: Map<string, RoomState> = new Map();

  async validate(events: EventTypeArray, context: any): Promise<EventTypeArray> {
    console.log(`Validating ${events.length} events against room state`);
    
    const eventsByRoom = this.groupEventsByRoom(events);
    
    const validatedEvents: EventTypeArray = [];
    for (const [roomId, roomEvents] of eventsByRoom.entries()) {
      const roomValidatedEvents = await this.validateRoomEvents(roomId, roomEvents, context);
      validatedEvents.push(...roomValidatedEvents);
    }
    
    return validatedEvents;
  }
  
  private groupEventsByRoom(events: EventTypeArray): Map<string, EventTypeArray> {
    const eventsByRoom = new Map<string, EventTypeArray>();
    
    for (const eventData of events) {
      const { eventId, event } = eventData;
      
      const roomId = this.extractRoomId(event.room_id);
      
      if (!roomId) {
        console.warn(`Event ${eventId} has invalid room ID: ${event.room_id}`);
        continue;
      }
      
      if (!eventsByRoom.has(roomId)) {
        eventsByRoom.set(roomId, []);
      }
      eventsByRoom.get(roomId)!.push(eventData);
    }
    
    return eventsByRoom;
  }
  
  private extractRoomId(roomIdString: string): string | null {
    if (!roomIdString) return null;
    
    const parts = roomIdString.split(':');
    return parts[0] || null;
  }
  
  private async validateRoomEvents(
    roomId: string, 
    roomEvents: EventTypeArray, 
    context: any
  ): Promise<EventTypeArray> {
    const validatedEvents: EventTypeArray = [];
    const roomState = await this.getRoomState(roomId, context);
    
    for (const eventData of roomEvents) {
      const { eventId, event } = eventData;
      
      try {
        const isValid = await this.validateEventAgainstRoomState({ eventId, event }, roomState);
        
        if (isValid) {
          validatedEvents.push(eventData);
          console.debug(`Event ${eventId} passed room state validation`);
        } else {
          validatedEvents.push({
            eventId,
            event,
            error: {
              errcode: "M_FAILED_ROOM_STATE_VALIDATION",
              error: "Event does not comply with room state rules"
            }
          });
          console.warn(`Event ${eventId} failed room state validation`);
        }
      } catch (error: any) {
        validatedEvents.push({
          eventId,
          event,
          error: {
            errcode: "M_FAILED_ROOM_STATE_VALIDATION",
            error: `Validation error: ${error.message}`
          }
        });
        console.warn(`Exception validating event ${eventId}: ${error.message}`);
      }
    }
    
    return validatedEvents;
  }
  
  private async getRoomState(roomId: string, context: any): Promise<RoomState> {
    let roomState = this.roomStates.get(roomId);
    
    if (!roomState) {
      roomState = new RoomState(roomId);
      this.roomStates.set(roomId, roomState);
      console.debug(`Created new RoomState for room ${roomId}`);
      
      await this.loadRoomStateFromDatabase(roomState, roomId, context);
    }
    
    return roomState;
  }

  private async loadRoomStateFromDatabase(
    roomState: RoomState, 
    roomId: string, 
    context: any
  ): Promise<void> {
    if (!context.mongo?.getRoomState) {
      console.debug(`No database connection available to load room state for ${roomId}`);
      return;
    }
    
    try {
      const storedState = await context.mongo.getRoomState(roomId);
      
      if (storedState) {
        console.debug(`Loading stored state for room ${roomId}`);
        await this.initializeRoomStateFromStorage(roomState, storedState);
        console.debug(`Successfully loaded stored state for room ${roomId}`);
      } else {
        console.debug(`No stored state found for room ${roomId}`);
      }
    } catch (error: any) {
      console.warn(`Failed to load room state for ${roomId}: ${error.message}`);
    }
  }

  private async initializeRoomStateFromStorage(
    roomState: RoomState, 
    storedState: any
  ): Promise<void> {
    const createEvent = storedState.stateEvents?.find((e: any) => e.type === 'm.room.create');
    if (createEvent) {
      await roomState.addEvent(createEvent);
    }
    
    const powerLevelsEvent = storedState.stateEvents?.find((e: any) => e.type === 'm.room.power_levels');
    if (powerLevelsEvent) {
      await roomState.addEvent(powerLevelsEvent);
    }
    
    if (storedState.stateEvents) {
      for (const event of storedState.stateEvents) {
        if (event.type !== 'm.room.create' && event.type !== 'm.room.power_levels') {
          await roomState.addEvent(event);
        }
      }
    }
    
    if (storedState.forwardExtremities) {
      for (const eventId of storedState.forwardExtremities) {
        const event = storedState.events?.find((e: any) => e.event_id === eventId);
        if (event) {
          await roomState.addEvent(event);
        }
      }
    }
  }
  
  private async validateEventAgainstRoomState(
    event: EventType, 
    roomState: RoomState
  ): Promise<boolean> {
    const tempRoomState = new RoomState(roomState.getRoomId());
    const stateEvents = roomState.getStateEvents();
    for (const stateEvent of stateEvents) {
      await tempRoomState.addEvent(stateEvent);
    }
    
    return await tempRoomState.addEvent(event);
  }
} 