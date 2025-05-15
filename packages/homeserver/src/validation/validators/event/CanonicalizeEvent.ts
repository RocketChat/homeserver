import { encodeCanonicalJson } from '../../../signJson';
import { failure, success } from '../../ValidationResult';
import { createValidator } from '../../Validator';
import type { CanonicalizedEvent, Event } from '../EventValidators';

/**
 * Canonicalizes event format to prepare for validation
 * 
 * Matrix spec defines a canonical form for JSON which is used for signing:
 * - Deterministic property order (lexicographically by property name)
 * - No whitespace or line breaks
 * - Unescaped string literals (no \n, \r, \t, etc.)
 * 
 * See: https://spec.matrix.org/v1.9/server-server-api/#canonical-json
 */
export const canonicalizeEvent = createValidator<Event, CanonicalizedEvent>(async (event, txnId, eventId) => {
  try {
    const { event: eventData } = event;
    
    // 1. Validate required event fields according to Matrix spec
    if (!eventData.type || typeof eventData.type !== 'string') {
      return failure('M_INVALID_EVENT', 'Event must have a valid type');
    }
    
    if (!eventData.room_id || typeof eventData.room_id !== 'string') {
      return failure('M_INVALID_EVENT', 'Event must have a valid room_id');
    }
    
    if (!eventData.sender || typeof eventData.sender !== 'string') {
      return failure('M_INVALID_EVENT', 'Event must have a valid sender');
    }
    
    if (!eventData.content || typeof eventData.content !== 'object') {
      return failure('M_INVALID_EVENT', 'Event must have valid content');
    }

    if (!eventData.origin_server_ts || typeof eventData.origin_server_ts !== 'number') {
      return failure('M_INVALID_EVENT', 'Event must have a valid origin_server_ts');
    }

    const { signatures, unsigned, ...eventWithoutSignatures } = eventData;
    
    let canonicalJsonStr: string;
    try {
      canonicalJsonStr = encodeCanonicalJson(eventWithoutSignatures);
    } catch (error) {
      return failure('M_INVALID_EVENT', `Event could not be canonicalized: ${error.message || String(error)}`);
    }
    
    return success({
      event: eventData,
      canonicalizedEvent: {
        canonical: true,
        canonicalJson: canonicalJsonStr
      }
    });
  } catch (error) {
    return failure('M_INVALID_EVENT', `Failed to canonicalize event: ${error.message || String(error)}`);
  }
}); 