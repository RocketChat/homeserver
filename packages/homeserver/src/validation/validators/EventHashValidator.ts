import { createValidator, success, failure } from '../Validator';
import { CanonicalizedEvent } from './index';
import { Logger } from '../../routes/federation/logger';
import { computeHash } from '../../authentication';

const logger = new Logger("EventHashValidator");

export const validateEventHash = createValidator<CanonicalizedEvent>(async (event, _, eventId) => {
  try {
    const { event: eventData } = event;
    
    if (!eventData.hashes || !eventData.hashes.sha256) {
      logger.warn(`Event ${eventId} missing required hash`);
      return failure('M_MISSING_HASH', 'Event is missing required sha256 hash');
    }

    const [algorithm, hash] = computeHash(eventData);
    const expectedHash = eventData.hashes[algorithm];
    
    if (hash !== expectedHash) {
      logger.warn(`Hash validation failed for event ${eventId}, expected: ${expectedHash}, got: ${hash}`);
      return failure('M_INVALID_HASH', 'Event hash validation failed - hashes do not match');
    }
    
    return success(event);
  } catch (error: any) {
    logger.error(`Error validating event hash: ${error.message || String(error)}`);
    return failure('M_INVALID_HASH', `Error validating event hash: ${error.message || String(error)}`);
  }
}); 