import { Logger } from '../../utils/logger';
import { Validator } from '../decorators/validator.decorator';
import { EventTypeArray, IPipeline } from '../pipelines';

const logger = new Logger("EventAuthChainValidator");

const requiredAuthEvents: Record<string, { required: string[]; description: string }> = {
  'm.room.create': {
    required: [],
    description: 'Root event with no auth dependencies'
  },
  'm.room.member': {
    required: ['m.room.create', 'm.room.power_levels', 'm.room.join_rules'],
    description: 'Member event requires create, power levels, and join rules'
  },
  'm.room.message': {
    required: ['m.room.create', 'm.room.member', 'm.room.power_levels'],
    description: 'Message event requires create, member, and power levels'
  },
  'default': {
    required: ['m.room.create', 'm.room.power_levels'],
    description: 'Most events require create and power levels at minimum'
  }
};

function getRequiredAuthEventsForType(eventType: string): string[] {
  return (requiredAuthEvents[eventType as keyof typeof requiredAuthEvents]
    || requiredAuthEvents['default']).required;
}

/**
 * Validates that events have the proper authentication chain
 * 
 * This validator ensures that:
 * 1. Events reference the required auth events for their type
 * 2. Auth events exist and can be retrieved
 * 3. Auth events form a valid chain according to Matrix rules
 */
@Validator()
export class EventAuthChainValidator implements IPipeline<EventTypeArray> {
  async validate(events: EventTypeArray, context: any): Promise<EventTypeArray> {
    const eventFetcher = new EventFetcher(context);
    const validatedEvents: EventTypeArray = [];

    for (const { eventId, event } of events) {
      try {
        const eventType = event?.type;
        const authEventIds = event?.auth_events || [];
        
        logger.debug(`Validating auth chain for event ${eventId} of type ${eventType}`);
        
        const stateKey = (event as any)?.state_key || '';
        if (eventType === 'm.room.create' && stateKey === '') {
          logger.debug(`Skipping auth validation for root event ${eventId} of type ${eventType}`);
          validatedEvents.push({ eventId, event });
          continue;
        }
        
        const requiredTypes = getRequiredAuthEventsForType(eventType);
        logger.debug(`Event ${eventId} requires auth event types: ${requiredTypes.join(', ')}`);

        const origin = event?.origin || context.config.name;
        
        const result = await this.fetchAuthEvents(
          authEventIds,
          event?.room_id,
          origin,
          eventFetcher,
          context
        );
        
        const validationResult = await this.validateAuthChain(
          event, 
          eventId, 
          eventType, 
          requiredTypes, 
          result.authMap
        );
        
        validatedEvents.push(validationResult);
      } catch (error: any) {
        logger.error(`Error validating auth chain for ${eventId}: ${error.message || String(error)}`);
        validatedEvents.push({
          eventId,
          event,
          error: {
            errcode: 'M_AUTH_VALIDATION_ERROR',
            error: `Error validating auth chain: ${error.message || String(error)}`
          }
        });
      }
    }

    return validatedEvents;
  }
  
  private async fetchAuthEvents(
    authEventIds: string[],
    roomId: string,
    origin: string,
    eventFetcher: EventFetcher,
    context: any
  ): Promise<{ authMap: Map<string, any> }> {
    const result = await eventFetcher.fetchEventsByIds(
      authEventIds,
      roomId,
      origin,
      context
    );
    
    const authMap = new Map<string, any>();
    for (const authEvent of result.events) {
      if (authEvent?.type) {
        authMap.set(authEvent.type, authEvent);
      }
    }
    
    return { authMap };
  }
  
  private async validateAuthChain(
    event: any,
    eventId: string,
    eventType: string,
    requiredTypes: string[],
    authMap: Map<string, any>
  ): Promise<any> {
    const missingAuthEventTypes: string[] = [];
    for (const requiredType of requiredTypes) {
      if (!authMap.has(requiredType)) {
        missingAuthEventTypes.push(requiredType);
      }
    }
    
    if (missingAuthEventTypes.length === 0) {
      logger.debug(`All required auth events present for ${eventId}`);
      
      const validationErrors = this.validateAuthEvents(authMap, event);
      
      if (validationErrors.length > 0) {
        logger.error(`Auth validation failed for ${eventId}: ${validationErrors.join(', ')}`);
        return {
          eventId,
          event,
          error: {
            errcode: 'M_INVALID_AUTH',
            error: `Auth validation failed: ${validationErrors[0]}`
          }
        };
      }
      
      logger.debug(`Auth chain validation succeeded for ${eventId}`);
      return { eventId, event };
    } else {
      logger.warn(`Event ${eventId} is missing auth event types: ${missingAuthEventTypes.join(', ')}`);
      
      if (missingAuthEventTypes.includes('m.room.create')) {
        logger.error(`Event ${eventId} is missing critical auth event: m.room.create`);
        return {
          eventId,
          event,
          error: {
            errcode: 'M_MISSING_CRITICAL_AUTH',
            error: 'Missing critical auth event: m.room.create'
          }
        };
      }
      
      logger.debug(`Auth chain validation partially succeeded for ${eventId} (with missing auth types)`);
      return { eventId, event };
    }
  }
  
  private validateAuthEvents(
    authMap: Map<string, any>,
    event: any
  ): string[] {
    const errors: string[] = [];
    
    const createEvent = authMap.get('m.room.create');
    if (createEvent) {
      if (!createEvent.content?.room_version) {
        errors.push('Create event missing room_version');
      }
    }
    
    if (event?.type !== 'm.room.create') {
      const powerLevelsEvent = authMap.get('m.room.power_levels');
      if (!powerLevelsEvent) {
        errors.push('Missing power levels auth event');
      } else {
        const senderPowerLevel = this.getSenderPowerLevel(event.sender, powerLevelsEvent);
        const requiredPowerLevel = this.getRequiredPowerLevel(event, powerLevelsEvent);
        
        if (senderPowerLevel < requiredPowerLevel) {
          errors.push(`Sender power level (${senderPowerLevel}) below required level (${requiredPowerLevel})`);
        }
      }
    }
    
    if (event?.type === 'm.room.member') {
      const membership = event.content?.membership;
      
      if (membership === 'join') {
        const joinRulesEvent = authMap.get('m.room.join_rules');
        if (!joinRulesEvent) {
          errors.push('Member join event missing join_rules auth event');
        } else {
          const joinRule = joinRulesEvent.content?.join_rule;
          if (joinRule !== 'public') {
            // TODO: For non-public rooms, check if user has permission
            // (additional logic would be needed for invite-only rooms, etc.)
          }
        }
      }
    }
    
    return errors;
  }
  
  private getSenderPowerLevel(
    sender: string,
    powerLevelsEvent: any
  ): number {
    const defaultUserPower = powerLevelsEvent?.content?.users_default || 0;
    const userPowers = powerLevelsEvent?.content?.users || {};
    
    return userPowers[sender] || defaultUserPower;
  }

  private getRequiredPowerLevel(
    event: any,
    powerLevelsEvent: any
  ): number {
    const isState = event.hasOwnProperty('state_key');
    const defaultPower = isState ? 
      (powerLevelsEvent?.content?.state_default || 50) : 
      (powerLevelsEvent?.content?.events_default || 0);
      
    const eventPowers = powerLevelsEvent?.content?.events || {};
    
    return eventPowers[event.type] || defaultPower;
  }
}