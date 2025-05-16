import { failure, success, type ValidationResult } from '../ValidationResult';
import type { AuthorizedEvent } from '../validators/EventValidators';
import { registerEventHandler } from './index';

enum JoinRule {
  PUBLIC = 'public',
  KNOCK = 'knock',
  INVITE = 'invite',
  PRIVATE = 'private',
  RESTRICTED = 'restricted'
}

export async function validateJoinRules(
  event: AuthorizedEvent,
  eventId: string
): Promise<ValidationResult> {
  try {
    const { event: rawEvent } = event;
    
    // Join rules must have state_key = ""
    if (rawEvent.state_key !== '') {
      console.error(`Join rules event ${eventId} has invalid state_key: '${rawEvent.state_key}'`);
      return failure('M_INVALID_PARAM', 'Join rules events must have an empty state_key');
    }
    
    // Check for required auth events in auth_event_objects
    const { auth_event_objects } = event.authorizedEvent;
    if (!auth_event_objects || auth_event_objects.length === 0) {
      console.error(`Join rules event ${eventId} is missing required auth events`);
      return failure('M_MISSING_AUTH_EVENTS', 'Join rules events must have auth events');
    }
    
    let createEvent = null;
    let powerLevels = null;
    let senderMembership = null;
    
    // Find the required auth events
    for (const authObj of auth_event_objects) {
      if (!authObj.event) continue;
      
      if (authObj.event.type === 'm.room.create' && authObj.event.state_key === '') {
        createEvent = authObj.event;
      } 
      else if (authObj.event.type === 'm.room.power_levels' && authObj.event.state_key === '') {
        powerLevels = authObj.event;
      }
      else if (authObj.event.type === 'm.room.member' && authObj.event.state_key === rawEvent.sender) {
        senderMembership = authObj.event;
      }
    }
    
    // Always require create event
    if (!createEvent) {
      console.error(`Join rules event ${eventId} missing required m.room.create event`);
      return failure('M_MISSING_AUTH_EVENTS', 'Join rules event must reference the room create event');
    }
    
    // Check that the sender is in the room
    if (!senderMembership) {
      console.error(`Join rules event ${eventId} missing sender's membership event`);
      return failure('M_MISSING_AUTH_EVENTS', 'Join rules events must reference the sender\'s membership');
    }
    
    if (senderMembership.content?.membership !== 'join') {
      console.error(`Join rules event ${eventId} sender is not joined to the room`);
      return failure('M_FORBIDDEN', 'Sender must be joined to the room to set join rules');
    }
    
    // Basic content validation
    const content = rawEvent.content || {};
    
    // join_rule is required
    if (!content.join_rule) {
      console.error(`Join rules event ${eventId} is missing required join_rule field`);
      return failure('M_MISSING_PARAM', 'Join rules events must specify a join_rule value');
    }
    
    // join_rule must be a valid value
    if (!Object.values(JoinRule).includes(content.join_rule)) {
      console.error(`Join rules event ${eventId} has invalid join_rule value: ${content.join_rule}`);
      return failure('M_INVALID_PARAM', 
        `Invalid join_rule value: ${content.join_rule}. Must be one of: ${Object.values(JoinRule).join(', ')}`);
    }
    
    // For restricted join rule, validate allow rules
    if (content.join_rule === JoinRule.RESTRICTED) {
      if (!content.allow || !Array.isArray(content.allow) || content.allow.length === 0) {
        console.error(`Join rules event ${eventId} with restricted join_rule is missing required allow rules`);
        return failure('M_MISSING_PARAM', 'Restricted rooms must specify allow rules');
      }
      
      // Validate each allow rule
      for (const rule of content.allow) {
        if (!rule.type) {
          console.error(`Join rules event ${eventId} has allow rule missing required type field`);
          return failure('M_MISSING_PARAM', 'Allow rules must specify a type');
        }
        
        if (rule.type === 'm.room_membership') {
          if (!rule.room_id) {
            console.error(`Join rules event ${eventId} has m.room_membership rule missing required room_id`);
            return failure('M_MISSING_PARAM', 'Room membership rules must specify a room_id');
          }
        } else {
          console.warn(`Join rules event ${eventId} has unknown allow rule type: ${rule.type}`);
          // Don't fail on unknown types, just warn
        }
      }
    }
    
    // Check if user has permission to change join rules
    if (powerLevels) {
      const eventPowerLevel = powerLevels.content?.events?.['m.room.join_rules'] ?? 
                              powerLevels.content?.state_default ?? 
                              50; // default for state events
      
      const userPowerLevel = powerLevels.content?.users?.[rawEvent.sender] ?? 
                             powerLevels.content?.users_default ?? 
                             0;
      
      // Only the room creator is allowed to set initial join rules without having existing power
      const isCreator = rawEvent.sender === createEvent.content?.creator;
      
      if (!isCreator && userPowerLevel < eventPowerLevel) {
        console.error(`Join rules event ${eventId} sender has insufficient power: ${userPowerLevel} < ${eventPowerLevel}`);
        return failure('M_FORBIDDEN', 'Sender does not have permission to change join rules');
      }
    }
    
    console.debug(`Join rules event ${eventId} passed validation`);
    return success(event);
    
  } catch (error: any) {
    console.error(`Error validating join rules event ${eventId}: ${error.message || String(error)}`);
    return failure('M_UNKNOWN', `Error validating join rules event: ${error.message || String(error)}`);
  }
}

export function registerJoinRulesValidator(): void {
  registerEventHandler('m.room.join_rules', validateJoinRules);
} 