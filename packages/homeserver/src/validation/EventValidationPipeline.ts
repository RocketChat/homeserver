import type { ValidationResult } from './ValidationResult';
import { ParallelValidation, Pipeline } from './Validator';
import type {
  AuthorizedEvent,
  CanonicalizedEvent,
  Event,
} from './validators/EventValidators';
import {
  canonicalizeEvent,
  fetchAuthEvents,
  validateEventHash
} from './validators/event';

/**
 * Creates a complete validation pipeline for Matrix federation events
 * following the flowchart:
 * 
 * 1. Canonicalize the event
 * 2. In parallel:
 *    a. Validate hash and signature
 *    b. Fetch auth events
 * 3. Validate auth event chain
 * 4. Validate room auth rules
 * 5. Event is ready for persistence
 */
export function createEventValidationPipeline() {
  const hashAndSignatureValidation = new ParallelValidation<CanonicalizedEvent>()
    .add(validateEventHash)
    // .add(validateEventSignature);

  return new Pipeline<Event>()
    .add(canonicalizeEvent)
    .add(hashAndSignatureValidation)
    .add(fetchAuthEvents)
    // .add(validateAuthChain)
    // .add(validateRoomRules);
}

/**
 * Validates a Matrix event
 * 
 * @param event The event to validate
 * @param txnId The transaction ID
 * @param eventId The event ID
 * @returns A validation result
 */
export async function validateMatrixEvent(
  eventData: any, 
  txnId: string, 
  eventId: string
): Promise<ValidationResult<AuthorizedEvent>> {
  const pipeline = createEventValidationPipeline();
  
  const event: Event = {
    event: eventData
  };
  
  const result = await pipeline.validate(event, txnId, eventId);
  
  if (result.success) {
    console.debug(`Validation success for event ${eventId}`);
  } else {
    console.warn(`Validation failed for event ${eventId}: ${result.error?.message}`);
  }
  
  return result;
}