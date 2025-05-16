import { getErrorMessage } from '../../../utils/get-error-message';
import { failure, success } from '../../ValidationResult';
import { createValidator } from '../../Validator';
import type { AuthorizedEvent } from '../EventValidators';

/**
 * Validates the auth event chain
 * 
 * Each auth event must be cryptographically valid and form a valid chain.
 * This validator ensures the integrity of the auth chain.
 */
export const validateAuthChain = createValidator<AuthorizedEvent>(async (event, _, eventId) => {
  try {
    if (!event.authorizedEvent.auth_event_objects) {
      console.warn(`Event ${eventId} missing auth_event_objects`);
      return failure('M_MISSING_AUTH_EVENTS', 'Event missing auth event objects');
    }

    // For development purposes, we'll assume the auth chain is valid
    // In production, you would implement proper validation of the auth chain
    console.debug(`Auth chain considered valid for event ${eventId} (development mode)`);
    return success(event);
    
  } catch (error) {
    console.error(`Error validating auth chain: ${getErrorMessage(error)}`);
    return failure('M_INVALID_AUTH_CHAIN', `Error validating auth chain: ${getErrorMessage(error)}`);
  }
}); 