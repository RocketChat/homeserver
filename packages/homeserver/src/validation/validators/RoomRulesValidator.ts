import { createValidator, success, failure, ValidationResult } from '../Validator';
import { AuthorizedEvent } from './index';
import { Logger } from '../../routes/federation/logger';

const logger = new Logger("RoomRulesValidator");

interface PowerLevels {
  users?: Record<string, number>;
  users_default?: number;
  events?: Record<string, number>;
  events_default?: number;
  state_default?: number;
  ban?: number;
  kick?: number;
  redact?: number;
  invite?: number;
}

export const validateRoomRules = createValidator<AuthorizedEvent>(async (event, _, eventId) => {
  try {
    logger.debug(`Validating room rules for event ${eventId}`);
    
    const { authorizedEvent } = event;
    
    if (!authorizedEvent.auth_event_objects || authorizedEvent.auth_event_objects.length === 0) {
      logger.warn(`Event ${eventId} missing auth_event_objects for room rules validation`);
      return failure('M_MISSING_AUTH_EVENTS', 'Event missing auth event objects');
    }
    
    const authEvents = new Map();
    authorizedEvent.auth_event_objects.forEach(authEvent => {
      if (authEvent.event && authEvent.event.type) {
        if (authEvent.event.state_key !== undefined) {
          authEvents.set(`${authEvent.event.type}|${authEvent.event.state_key}`, authEvent.event);
        } else {
          authEvents.set(authEvent.event.type, authEvent.event);
        }
      }
    });
    
    const createEvent = authEvents.get('m.room.create|');
    if (!createEvent) {
      logger.error(`Missing required create event for rules validation`);
      return failure('M_FORBIDDEN', 'Missing required create event');
    }
    
    // Get the sender of the current event
    const sender = event.event.sender;
    if (!sender) {
      logger.error(`Event ${eventId} has no sender`);
      return failure('M_INVALID_SENDER', 'Event has no sender');
    }
    
    // Get power levels if available
    const powerLevelsEvent = authEvents.get('m.room.power_levels|');
    const powerLevels: PowerLevels = powerLevelsEvent?.content || {};
    
    // Different validation rules based on event type
    const eventType = event.event.type;
    const stateKey = event.event.state_key;
    
    // 1. Check room creator for create events
    if (eventType === 'm.room.create') {
      // Create events must have the sender match the creator
      if (event.event.content?.creator !== sender) {
        logger.error(`Create event sender doesn't match creator field: ${sender} vs ${event.event.content?.creator}`);
        return failure('M_INVALID_CREATOR', 'Create event sender must match the creator field');
      }
    }
    
    // 2. For member events, validate based on membership type
    else if (eventType === 'm.room.member') {
      if (stateKey === sender) {
        if (event.event.content?.membership === 'join') {
          const joinRulesEvent = authEvents.get('m.room.join_rules|');
          
          if (joinRulesEvent && joinRulesEvent.content?.join_rule === 'invite') {
            const memberEvent = authEvents.get(`m.room.member|${sender}`);
            const existingMembership = memberEvent?.content?.membership;
            
            if (existingMembership !== 'invite' && 
                existingMembership !== 'join' && 
                sender !== createEvent.content?.creator) {
              logger.error(`User ${sender} tried to join invite-only room without invite`);
              return failure('M_FORBIDDEN', 'Cannot join an invite-only room without an invite');
            }
          }
        }
      } 
      else {
        if (event.event.content?.membership === 'invite') {
          const userPowerLevel = getUserPowerLevel(sender, powerLevels);
          if (userPowerLevel < (powerLevels.invite ?? 50)) {
            logger.error(`User ${sender} doesn't have permission to invite (power level: ${userPowerLevel})`);
            return failure('M_FORBIDDEN', `User doesn't have permission to invite`);
          }
        }
        
        else if (['ban', 'kick'].includes(event.event.content?.membership || '')) {
          const targetUser = stateKey;
          const action = event.event.content?.membership;
          
          const senderPowerLevel = getUserPowerLevel(sender, powerLevels);
          const targetPowerLevel = getUserPowerLevel(targetUser!, powerLevels);
          const requiredPowerLevel = action === 'ban' ? 
            (powerLevels.ban ?? 50) : (powerLevels.kick ?? 50);
          
          if (senderPowerLevel < requiredPowerLevel) {
            logger.error(`User ${sender} doesn't have permission to ${action} (power level: ${senderPowerLevel}, required: ${requiredPowerLevel})`);
            return failure('M_FORBIDDEN', `User doesn't have permission to ${action}`);
          }
          
          if (senderPowerLevel <= targetPowerLevel) {
            logger.error(`User ${sender} cannot ${action} user ${targetUser} with equal or higher power level`);
            return failure('M_FORBIDDEN', `Cannot ${action} user with equal or higher power level`);
          }
        }
      }
    }
    
    // 3. For power level events, check sender permissions and prevent privilege escalation
    else if (eventType === 'm.room.power_levels') {
      const userPowerLevel = getUserPowerLevel(sender, powerLevels);
      
      if (userPowerLevel < (powerLevels.events?.['m.room.power_levels'] ?? powerLevels.state_default ?? 50)) {
        logger.error(`User ${sender} doesn't have permission to change power levels (power level: ${userPowerLevel})`);
        return failure('M_FORBIDDEN', 'User doesn\'t have permission to change power levels');
      }
      
      const newPowerLevels = event.event.content as PowerLevels;
      if (newPowerLevels && newPowerLevels.users) {
        for (const [user, level] of Object.entries(newPowerLevels.users)) {
          const oldLevel = getUserPowerLevel(user, powerLevels);
          if (level > oldLevel && userPowerLevel <= oldLevel) {
            logger.error(`User ${sender} attempted to increase power level of ${user} beyond their own power`);
            return failure('M_FORBIDDEN', 'Cannot increase power level of others beyond your own power level');
          }
        }
      }
    }
    
    // 4. For state events (not already handled), check state power levels
    else if (stateKey !== undefined) {
      const userPowerLevel = getUserPowerLevel(sender, powerLevels);
      const requiredPowerLevel = getRequiredPowerLevelForState(eventType, powerLevels);
      
      if (userPowerLevel < requiredPowerLevel) {
        logger.error(`User ${sender} doesn't have permission for state event ${eventType} (power level: ${userPowerLevel}, required: ${requiredPowerLevel})`);
        return failure('M_FORBIDDEN', `User doesn't have permission for state event ${eventType}`);
      }
    }
    
    // 5. For normal message events, check event power levels
    else {
      const memberEvent = authEvents.get(`m.room.member|${sender}`);
      if (!memberEvent || memberEvent.content?.membership !== 'join') {
        logger.error(`User ${sender} tried to send message without being in the room`);
        return failure('M_FORBIDDEN', 'Cannot send messages without joining the room first');
      }
      
      const userPowerLevel = getUserPowerLevel(sender, powerLevels);
      const requiredPowerLevel = getRequiredPowerLevelForEvent(eventType, powerLevels);
      
      if (userPowerLevel < requiredPowerLevel) {
        logger.error(`User ${sender} doesn't have permission for event ${eventType} (power level: ${userPowerLevel}, required: ${requiredPowerLevel})`);
        return failure('M_FORBIDDEN', `User doesn't have permission for event ${eventType}`);
      }
    }
    
    logger.debug(`Room rules validation passed for event ${eventId}`);
    return success(event);
    
  } catch (error: any) {
    logger.error(`Error validating room rules for ${eventId}: ${error.message || String(error)}`);
    return failure('M_UNAUTHORIZED', `Error validating room rules: ${error.message || String(error)}`);
  }
});

function getUserPowerLevel(userId: string, powerLevels: PowerLevels): number {
  if (powerLevels.users && powerLevels.users[userId] !== undefined) {
    return powerLevels.users[userId];
  }
  return powerLevels.users_default ?? 0;
}

function getRequiredPowerLevelForState(eventType: string, powerLevels: PowerLevels): number {
  if (powerLevels.events && powerLevels.events[eventType] !== undefined) {
    return powerLevels.events[eventType];
  }
  return powerLevels.state_default ?? 50;
}

function getRequiredPowerLevelForEvent(eventType: string, powerLevels: PowerLevels): number {
  if (powerLevels.events && powerLevels.events[eventType] !== undefined) {
    return powerLevels.events[eventType];
  }
  return powerLevels.events_default ?? 0;
} 