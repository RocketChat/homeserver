import { Logger } from '../../../routes/federation/logger';
import { ValidationResult, success, failure } from '../../../validation/Validator';
import { AuthorizedEvent } from '../index';
import { registerEventHandler } from './index';

const logger = new Logger("m.room.create");

export async function validateCreateEvent(
  event: AuthorizedEvent,
  eventId: string
): Promise<ValidationResult> {
  try {
    const { event: rawEvent } = event;
    
    // Create events must have state_key = ""
    if (rawEvent.state_key !== '') {
      logger.error(`Create event ${eventId} has invalid state_key: '${rawEvent.state_key}'`);
      return failure('M_INVALID_PARAM', 'Create events must have an empty state_key');
    }
    
    // Create events must be the first event in the room - no auth events
    const authEvents = event.authorizedEvent.auth_event_objects || [];
    if (authEvents.length > 0) {
      logger.error(`Create event ${eventId} has ${authEvents.length} auth events which is not allowed`);
      return failure('M_FORBIDDEN', 'Create events must not have auth events');
    }
    
    // Basic content validation
    const content = rawEvent.content || {};
    
    // creator is required
    if (!content.creator) {
      logger.error(`Create event ${eventId} is missing required creator field`);
      return failure('M_MISSING_PARAM', 'Create events must specify a creator');
    }
    
    // creator must match sender
    if (content.creator !== rawEvent.sender) {
      logger.error(`Create event ${eventId} has creator (${content.creator}) that doesn't match sender (${rawEvent.sender})`);
      return failure('M_INVALID_PARAM', 'Create event creator must match sender');
    }
    
    // room_version is required (or defaults to "1")
    if (content.room_version && typeof content.room_version !== 'string') {
      logger.error(`Create event ${eventId} has invalid room_version: ${content.room_version}`);
      return failure('M_INVALID_PARAM', 'room_version must be a string');
    }
    
    // Validate room version is supported
    const roomVersion = content.room_version || '1';
    const supportedVersions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    if (!supportedVersions.includes(roomVersion)) {
      logger.warn(`Create event ${eventId} uses unsupported room version: ${roomVersion}`);
      // We don't fail on this because we might want to still process these events
      // but we log a warning
    }
    
    // Validate predefined_state_events if present
    if (content.predefined_state_events) {
      if (!Array.isArray(content.predefined_state_events)) {
        logger.error(`Create event ${eventId} has invalid predefined_state_events (not an array)`);
        return failure('M_INVALID_PARAM', 'predefined_state_events must be an array');
      }
      
      // Check each predefined state event
      for (const stateEvent of content.predefined_state_events) {
        if (!stateEvent.type || !stateEvent.state_key || !stateEvent.content) {
          logger.error(`Create event ${eventId} has invalid predefined state event: missing required fields`);
          return failure('M_INVALID_PARAM', 'Predefined state events must have type, state_key and content');
        }
      }
    }
    
    // Validate predecessor if present
    if (content.predecessor) {
      if (typeof content.predecessor !== 'object') {
        logger.error(`Create event ${eventId} has invalid predecessor (not an object)`);
        return failure('M_INVALID_PARAM', 'predecessor must be an object');
      }
      
      if (!content.predecessor.room_id || typeof content.predecessor.room_id !== 'string') {
        logger.error(`Create event ${eventId} has invalid predecessor room_id`);
        return failure('M_INVALID_PARAM', 'predecessor.room_id must be a string');
      }
      
      if (!content.predecessor.event_id || typeof content.predecessor.event_id !== 'string') {
        logger.error(`Create event ${eventId} has invalid predecessor event_id`);
        return failure('M_INVALID_PARAM', 'predecessor.event_id must be a string');
      }
    }
    
    logger.debug(`Create event ${eventId} passed validation`);
    return success(event);
    
  } catch (error: any) {
    logger.error(`Error validating create event ${eventId}: ${error.message || String(error)}`);
    return failure('M_UNKNOWN', `Error validating create event: ${error.message || String(error)}`);
  }
}

export function registerCreateValidator(): void {
  registerEventHandler('m.room.create', validateCreateEvent);
} 