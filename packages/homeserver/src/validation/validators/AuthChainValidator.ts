import { createValidator, success, failure } from '../Validator';
import { AuthorizedEvent } from './index';
import { Logger } from '../../routes/federation/logger';
import { eventTypeValidator, registerAllEventValidators } from './events';

const logger = new Logger("AuthChainValidator");

export const initializeEventValidators = () => registerAllEventValidators();

/**
 * Validates the auth event chain
 * 
 * Matrix events have an auth_events field that references the events that
 * authorize this event. This validator ensures that:
 * 1. All referenced auth events are valid
 * 2. The auth chain forms a consistent history
 * 3. The auth events contain the minimal required events
 * 4. Delegates to event-specific validators for detailed validation
 */
export const validateAuthChain = createValidator<AuthorizedEvent>(async (event, txnId, eventId) => {
  try {
    const { authorizedEvent } = event;
    
    if (!authorizedEvent.auth_event_objects || authorizedEvent.auth_event_objects.length === 0) {
      // Special case for m.room.create which doesn't need auth events
      if (event.event.type === 'm.room.create' && event.event.state_key === '') {
        logger.debug(`Create event ${eventId} doesn't need auth events`);
      } else {
        logger.warn(`Event ${eventId} missing auth_event_objects`);
        return failure('M_MISSING_AUTH_EVENTS', 'Event missing auth event objects');
      }
    }
    
    const hasIncompleteChain = authorizedEvent.incomplete_chain === true;
    logger.debug(`Validating auth chain for event ${eventId} with ${authorizedEvent.auth_event_objects?.length || 0} auth events${hasIncompleteChain ? ' (incomplete chain)' : ''}`);
    
    const authEvents = new Map();
    if (authorizedEvent.auth_event_objects) {
      authorizedEvent.auth_event_objects.forEach(authEvent => {
        if (authEvent.event && authEvent.event.type) {
          if (authEvent.event.state_key !== undefined) {
            authEvents.set(`${authEvent.event.type}|${authEvent.event.state_key}`, authEvent.event);
          } else {
            authEvents.set(authEvent.event.type, authEvent.event);
          }
        }
      });
    }
    
    if (event.event.type !== 'm.room.create' || event.event.state_key !== '') {
      const createEvent = authEvents.get('m.room.create|');
      if (!createEvent) {
        logger.error(`No create event found in auth chain for ${eventId}`);
        return failure('M_MISSING_CREATE_EVENT', 'Auth chain is missing the required create event');
      }
      
      const roomVersion = createEvent.content?.room_version;
      if (!roomVersion) {
        logger.error(`Create event doesn't specify room version`);
        return failure('M_INVALID_ROOM_VERSION', 'Create event does not specify room version');
      }
    }
    
    if (hasIncompleteChain) {
      logger.warn(`Performing limited validation for ${eventId} due to incomplete auth chain`);
      logger.warn(`Allowing event ${eventId} with incomplete auth chain due to partial validation`);
      // Event-specific validators will still run and can validate what's available
    }
    
    if (authorizedEvent.auth_event_objects) {
      for (const authObj of authorizedEvent.auth_event_objects) {
        if (!authObj.event.signatures) {
          logger.error(`Auth event missing signatures: ${JSON.stringify(authObj.event.type)}`);
          return failure('M_MISSING_SIGNATURES', 'Auth event is missing signatures');
        }
        
        if (!authObj.event.hashes) {
          logger.error(`Auth event missing hashes: ${JSON.stringify(authObj.event.type)}`);
          return failure('M_MISSING_HASHES', 'Auth event is missing hashes');
        }
      }
    }
    
    logger.debug(`Auth chain validation succeeded for event ${eventId}, running event-specific validation`);
    
    const validationResult = await eventTypeValidator(event, eventId);
    if (!validationResult.success) {
      logger.error(`Event-specific validation failed for ${eventId}: ${validationResult.error?.message}`);
      return validationResult;
    }
    
    logger.debug(`Event-specific validation succeeded for ${eventId}`);
    return success(event);
    
  } catch (error: any) {
    logger.error(`Error validating auth chain: ${error.message || String(error)}`);
    return failure('M_INVALID_AUTH_CHAIN', `Error validating auth chain: ${error.message || String(error)}`);
  }
});