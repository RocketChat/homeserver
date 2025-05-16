import { Validator } from '../decorators/validator.decorator';
import type { EventTypeArray, IPipeline } from '../pipelines';

@Validator()
export class EventTypeSpecificValidator implements IPipeline<EventTypeArray> {
  async validate(events: EventTypeArray , _context: any): Promise<EventTypeArray> {
    const response: EventTypeArray = [];

    for (const event of events) {
      try {
        const eventId = event?.eventId;
        const eventType = event?.event.type;
        
        console.debug(`Validating event type specific rules for ${eventId} of type ${eventType}`);
        
        if (eventType === 'm.room.create') {
          const errors = this.validateCreateEvent(event.event);
          
          if (errors.length > 0) {
            console.error(`Create event ${eventId} validation failed: ${errors.join(', ')}`);
            response.push({
              eventId,
              error: {
                errcode: 'M_INVALID_CREATE_EVENT',
                error: `Create event validation failed: ${errors[0]}`
              },
              event: event.event
            });
            continue;
          }
        } else {
          const errors = this.validateNonCreateEvent(event.event);
          
          if (errors.length > 0) {
            console.error(`Event ${eventId} validation failed: ${errors.join(', ')}`);
            response.push({
              eventId,
              error: {
                errcode: 'M_INVALID_EVENT',
                error: `Event validation failed: ${errors[0]}`
              },
              event: event.event
            });
            continue;
          }
        }
        
        console.debug(`Event ${eventId} passed type-specific validation`);
        response.push({
          eventId,
          event: event.event
        });
      } catch (error: any) {
        const eventId = event?.eventId || 'unknown';
        console.error(`Error in type-specific validation for ${eventId}: ${error.message || String(error)}`);
        response.push({
          eventId,
          error: {
            errcode: 'M_TYPE_VALIDATION_ERROR',
            error: `Error in type-specific validation: ${error.message || String(error)}`
          },
          event: event.event
        });
      }
    }

    return response;
  }
  
  private validateCreateEvent(event: any): string[] {
    const errors: string[] = [];
    
    if (event.prev_events && event.prev_events.length > 0) {
      errors.push('Create event must not have prev_events');
    }
    
    if (event.room_id && event.sender) {
      const roomDomain = this.extractDomain(event.room_id);
      const senderDomain = this.extractDomain(event.sender);
      
      if (roomDomain !== senderDomain) {
        errors.push(`Room ID domain (${roomDomain}) does not match sender domain (${senderDomain})`);
      }
    }
    
    if (event.auth_events && event.auth_events.length > 0) {
      errors.push('Create event must not have auth_events');
    }
    
    if (!event.content || !event.content.room_version) {
      errors.push('Create event must specify a room_version');
    } else {
      const validRoomVersions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
      if (!validRoomVersions.includes(event.content.room_version)) {
        errors.push(`Unsupported room version: ${event.content.room_version}`);
      }
    }
    
    return errors;
  }
  
  private validateNonCreateEvent(event: any): string[] {
    const errors: string[] = [];
    
    if (!event.prev_events || !Array.isArray(event.prev_events) || event.prev_events.length === 0) {
      errors.push('Event must reference previous events (prev_events)');
    }
    
    // TODO: Add DB room check
    if (event.room_id) {
      // const roomIdRegex = /^![\w-]+:[\w.-]+\.\w+$/;
      // if (!roomIdRegex.test(event.room_id)) {
      // errors.push(`Invalid room_id format: ${event.room_id}`);
      // }
    }
    
    return errors;
  }
  
  private extractDomain(id: string): string {
    const parts = id.split(':');
    return parts.length > 1 ? parts[1] : '';
  }
} 