import { createValidator, success, failure } from '../Validator';
import { Event, CanonicalizedEvent } from './index';
import { encodeCanonicalJson } from '../../signJson';

export const canonicalizeEvent = createValidator<Event, CanonicalizedEvent>(async (event, _, __, context) => {
  try {
    const { event: eventData } = event;
    
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
    } catch (error: any) {
      return failure('M_INVALID_EVENT', `Event could not be canonicalized: ${error.message || String(error)}`);
    }
    
    return success({
      event: eventData,
      canonicalizedEvent: {
        canonical: true,
        canonicalJson: canonicalJsonStr
      }
    });
  } catch (error: any) {
    return failure('M_INVALID_EVENT', `Failed to canonicalize event: ${error.message || String(error)}`);
  }
}); 