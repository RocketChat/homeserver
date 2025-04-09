import { SequentialPipeline, ParallelPipeline, ValidationResult } from './Validator';
import { 
  Event, 
  CanonicalizedEvent,
  AuthorizedEvent,
} from './validators';
import { 
  canonicalizeEvent, 
  fetchAuthEvents, 
  validateEventHash, 
  validateEventSignature, 
  validateAuthChain,
  validateRoomRules 
} from './validators';

import { initializeEventValidators } from './validators/AuthChainValidator';

export const initializeValidationPipeline = () => initializeEventValidators();

export function createEventValidationPipeline() {
  const hashAndSignatureValidation = new ParallelPipeline<CanonicalizedEvent>()
    .add(validateEventHash)
    // .add(validateEventSignature);

  const validateAuthEvents = new SequentialPipeline<AuthorizedEvent>()
    .add(fetchAuthEvents)
    .add(validateAuthChain)
    .add(validateRoomRules);

  return new SequentialPipeline<Event>()
    .add(canonicalizeEvent)
    .add(hashAndSignatureValidation)
    .add(validateAuthEvents);
}

export async function validateMatrixEvent(
  eventData: any, 
  txnId: string, 
  eventId: string,
  context: any
): Promise<ValidationResult<AuthorizedEvent>> {
  return createEventValidationPipeline().validate({ event: eventData }, txnId, eventId, context);
}