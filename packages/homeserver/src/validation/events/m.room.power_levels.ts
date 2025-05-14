import { Logger } from '../../utils/logger';
import { AuthorizedEvent, ValidationResult, failure, success } from '../validators/index';
import { registerEventHandler } from './index';

const logger = new Logger("m.room.power_levels");

export async function validatePowerLevels(
  event: AuthorizedEvent,
  eventId: string
): Promise<ValidationResult> {
  try {
    const { event: rawEvent } = event;
    
    // Power levels must have state_key = ""
    if (rawEvent.state_key !== '') {
      logger.error(`Power levels event ${eventId} has invalid state_key: '${rawEvent.state_key}'`);
      return failure('M_INVALID_PARAM', 'Power levels events must have an empty state_key');
    }
    
    // Check for required auth events in auth_event_objects
    const { auth_event_objects } = event.authorizedEvent;
    if (!auth_event_objects || auth_event_objects.length === 0) {
      logger.error(`Power levels event ${eventId} is missing required auth events`);
      return failure('M_MISSING_AUTH_EVENTS', 'Power levels events must have auth events');
    }
    
    let createEvent = null;
    let previousPowerLevels = null;
    let senderMembership = null;
    
    // Find the required auth events
    for (const authObj of auth_event_objects) {
      if (!authObj.event) continue;
      
      if (authObj.event.type === 'm.room.create' && authObj.event.state_key === '') {
        createEvent = authObj.event;
      } 
      else if (authObj.event.type === 'm.room.power_levels' && authObj.event.state_key === '') {
        previousPowerLevels = authObj.event;
      }
      else if (authObj.event.type === 'm.room.member' && authObj.event.state_key === rawEvent.sender) {
        senderMembership = authObj.event;
      }
    }
    
    // Always require create event
    if (!createEvent) {
      logger.error(`Power levels event ${eventId} missing required m.room.create event`);
      return failure('M_MISSING_AUTH_EVENTS', 'Power levels event must reference the room create event');
    }
    
    // Check that the sender is in the room
    if (!senderMembership) {
      logger.error(`Power levels event ${eventId} missing sender's membership event`);
      return failure('M_MISSING_AUTH_EVENTS', 'Power levels events must reference the sender\'s membership');
    }
    
    if (senderMembership.content?.membership !== 'join') {
      logger.error(`Power levels event ${eventId} sender is not joined to the room`);
      return failure('M_FORBIDDEN', 'Sender must be joined to the room to set power levels');
    }
    
    // Basic content validation
    const content = rawEvent.content || {};
    
    // Ensure power levels are numbers
    const numericalFields = [
      'ban', 'kick', 'redact', 'invite', 
      'events_default', 'state_default', 'users_default'
    ];
    
    for (const field of numericalFields) {
      if (content[field] !== undefined && 
          (typeof content[field] !== 'number' || !Number.isInteger(content[field]))) {
        logger.error(`Power levels event ${eventId} has invalid ${field}: ${content[field]}`);
        return failure('M_INVALID_PARAM', `${field} must be an integer`);
      }
    }
    
    // Check events and users sections
    if (content.events && typeof content.events !== 'object') {
      logger.error(`Power levels event ${eventId} has invalid events field (not an object)`);
      return failure('M_INVALID_PARAM', 'events must be an object');
    }
    
    if (content.users && typeof content.users !== 'object') {
      logger.error(`Power levels event ${eventId} has invalid users field (not an object)`);
      return failure('M_INVALID_PARAM', 'users must be an object');
    }
    
    // Check that all event power levels are integers
    if (content.events) {
      for (const [eventType, powerLevel] of Object.entries(content.events)) {
        if (typeof powerLevel !== 'number' || !Number.isInteger(powerLevel)) {
          logger.error(`Power levels event ${eventId} has invalid power level for ${eventType}: ${powerLevel}`);
          return failure('M_INVALID_PARAM', `Event power levels must be integers`);
        }
      }
    }
    
    // Check that all user power levels are integers
    if (content.users) {
      for (const [userId, powerLevel] of Object.entries(content.users)) {
        if (typeof powerLevel !== 'number' || !Number.isInteger(powerLevel)) {
          logger.error(`Power levels event ${eventId} has invalid power level for ${userId}: ${powerLevel}`);
          return failure('M_INVALID_PARAM', `User power levels must be integers`);
        }
      }
    }
    
    // Check if user has permission to change power levels 
    // (they need power above the required power to send power level events)
    if (previousPowerLevels) {
      const eventPowerLevel = previousPowerLevels.content?.events?.['m.room.power_levels'] ?? 
                              previousPowerLevels.content?.state_default ?? 
                              50; // default for state events
      
      const userPowerLevel = previousPowerLevels.content?.users?.[rawEvent.sender] ?? 
                             previousPowerLevels.content?.users_default ?? 
                             0;
                       
      // Only the room creator is allowed to set initial power levels without having existing power
      const isCreator = rawEvent.sender === createEvent.content?.creator;
      
      if (!isCreator && userPowerLevel < eventPowerLevel) {
        logger.error(`Power levels event ${eventId} sender has insufficient power: ${userPowerLevel} < ${eventPowerLevel}`);
        return failure('M_FORBIDDEN', 'Sender does not have permission to change power levels');
      }
      
      // Verify that users can't change power levels of others with more power than themselves
      if (content.users) {
        for (const [userId, newPowerLevel] of Object.entries(content.users)) {
          const currentPowerLevel = previousPowerLevels.content?.users?.[userId] ?? 
                                   previousPowerLevels.content?.users_default ?? 
                                   0;
                                 
          // Can't change power levels of users with higher power
          if (userId !== rawEvent.sender && // users can demote themselves
              currentPowerLevel > userPowerLevel && 
              currentPowerLevel !== newPowerLevel) {
            logger.error(`Power levels event ${eventId} tries to change power of ${userId} from ${currentPowerLevel} to ${newPowerLevel}, but sender only has ${userPowerLevel}`);
            return failure('M_FORBIDDEN', 'Cannot change power levels of users with higher power than yourself');
          }
        }
      }
    }
    
    logger.debug(`Power levels event ${eventId} passed validation`);
    return success(event);
    
  } catch (error: any) {
    logger.error(`Error validating power levels event ${eventId}: ${error.message || String(error)}`);
    return failure('M_UNKNOWN', `Error validating power levels event: ${error.message || String(error)}`);
  }
}

export function registerPowerLevelsValidator(): void {
  registerEventHandler('m.room.power_levels', validatePowerLevels);
} 