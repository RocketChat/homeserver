import { computeHash } from '../../../authentication';
import { failure, success } from '../../ValidationResult';
import { createValidator } from '../../Validator';
import type { CanonicalizedEvent } from '../EventValidators';

/**
 * Validates the event hash against the canonical event
 * 
 * Matrix events are cryptographically hashed to ensure integrity. 
 * This validator directly mirrors the logic in checkSignAndHashes.ts
 */
export const validateEventHash = createValidator<CanonicalizedEvent>(async (event, _, eventId) => {
  try {
    const { event: eventData } = event;
    
    if (!eventData.hashes || !eventData.hashes.sha256) {
      console.warn(`Event ${eventId} missing required hash`);
      return failure('M_MISSING_HASH', 'Event is missing required sha256 hash');
    }

    const [algorithm, hash] = computeHash(eventData);
    const expectedHash = eventData.hashes[algorithm];
    
    if (hash !== expectedHash) {
      console.warn(`Hash validation failed for event ${eventId}, expected: ${expectedHash}, got: ${hash}`);
      return failure('M_INVALID_HASH', 'Event hash validation failed - hashes do not match');
    }
    
    return success(event);
  } catch (error) {
    console.error(`Error validating event hash: ${error.message || String(error)}`);
    return failure('M_INVALID_HASH', `Error validating event hash: ${error.message || String(error)}`);
  }
}); 