import { Collection, MongoClient } from 'mongodb';
import { generateId } from '../../../authentication';
import { makeRequest } from '../../../makeRequest';
import { extractOrigin } from '../../../utils/extractOrigin';
import { getErrorMessage } from '../../../utils/get-error-message';
import { getServerName } from '../../../utils/serverConfig';
import { failure, success } from '../../ValidationResult';
import { createValidator } from '../../Validator';
import type { AuthorizedEvent, CanonicalizedEvent } from '../EventValidators';

interface StoredEvent {
  _id: string;
  event: unknown;
}

let client: MongoClient | null = null;
let eventsCollection: Collection<StoredEvent> | null = null;

async function ensureDbConnection() {
  if (!client) {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db('matrix');
    eventsCollection = db.collection<StoredEvent>('events');
  }
  
  if (!eventsCollection) {
    throw new Error('Failed to initialize events collection');
  }
  
  return { eventsCollection };
}

/**
 * Fetches and validates auth events
 * 
 * Matrix events are authorized based on a chain of previous events.
 * This validator fetches those auth events and prepares them for validation.
 */
export const fetchAuthEvents = createValidator<CanonicalizedEvent, AuthorizedEvent>(async (event, txnId, eventId) => {
  try {
    console.debug(`Fetching auth events for event ${eventId}`);
    
    const { eventsCollection } = await ensureDbConnection();
    
    const authEventIds = event.event.auth_events || [];
    if (authEventIds.length === 0) {
      console.warn(`Event ${eventId} has no auth events`);
      return failure('M_MISSING_AUTH_EVENTS', 'Event has no auth events');
    }

    console.debug(`Checking for locally available auth events: ${authEventIds.join(', ')}`);
    const existingEvents = await eventsCollection.find({ 
      _id: { $in: authEventIds }
    }).toArray();
    
    const existingEventMap = new Map(existingEvents.map(e => [e._id, e]));
    
    const missingEventIds = authEventIds.filter((id: string) => !existingEventMap.has(id));
    
    if (missingEventIds.length === 0) {
      console.debug(`All auth events found locally for ${eventId}`);
      
      const authEventObjects = existingEvents.map(storedEvent => ({
        event: storedEvent.event
      }));
      
      return success({
        event: event.event,
        canonicalizedEvent: event.canonicalizedEvent,
        authorizedEvent: {
          auth_events: authEventIds,
          auth_event_objects: authEventObjects,
          signatures: event.event.signatures,
          hashes: event.event.hashes
        }
      });
    }
    
    console.debug(`Need to fetch ${missingEventIds.length} missing auth events from remote: ${missingEventIds.join(', ')}`);
    
    const origin = extractOrigin(event.event.sender);
    const localServerName = getServerName();
    const roomId = event.event.room_id;
    
    try {
      const response = await makeRequest({
        method: 'POST',
        domain: origin,
        uri: `/_matrix/federation/v1/get_missing_events/${roomId}`,
        body: {
          earliest_events: [],
          latest_events: missingEventIds,
          limit: missingEventIds.length,
          min_depth: 0
        },
        signingName: localServerName
      }) as { events: unknown[] };
      
      if (!response.events || !Array.isArray(response.events) || response.events.length === 0) {
        console.warn(`No events returned from ${origin} for auth events: ${missingEventIds.join(', ')}`);
        return failure('M_MISSING_AUTH_EVENTS', 'Remote server did not return required auth events');
      }
      
      // TODO: Validate the events before storing them
      await Promise.all(response.events.map(async (fetchedEvent) => {
        const fetchedEventId = generateId(fetchedEvent as object);
        await eventsCollection.updateOne(
          { _id: fetchedEventId },
          { $set: { event: fetchedEvent } },
          { upsert: true }
        );
        
        existingEventMap.set(fetchedEventId, { _id: fetchedEventId, event: fetchedEvent });
      }));
      
      const stillMissingIds = authEventIds.filter((id: string) => !existingEventMap.has(id));
      
      if (stillMissingIds.length > 0) {
        console.warn(`Still missing ${stillMissingIds.length} auth events after fetching: ${stillMissingIds.join(', ')}`);
        return failure('M_MISSING_AUTH_EVENTS', `Failed to retrieve all required auth events: ${stillMissingIds.join(', ')}`);
      }
      
      const allAuthEventObjects = authEventIds.map((id: string) => {
        const storedEvent = existingEventMap.get(id);
        return {
          event: storedEvent!.event
        };
      });
      
      console.debug(`Successfully fetched all auth events for ${eventId}`);
      
      return success({
        event: event.event,
        canonicalizedEvent: event.canonicalizedEvent,
        authorizedEvent: {
          auth_events: authEventIds,
          auth_event_objects: allAuthEventObjects,
          signatures: event.event.signatures,
          hashes: event.event.hashes
        }
      });
      
    } catch (networkError) {
      console.error(`Network error fetching auth events from ${origin}: ${getErrorMessage(networkError)}`);
      return failure('M_FAILED_TO_FETCH_AUTH', `Failed to fetch auth events: ${getErrorMessage(networkError)}`);
    }
  } catch (error) {
    console.error(`Failed to fetch auth events for ${eventId}: ${getErrorMessage(error)}`);
    return failure('M_MISSING_AUTH_EVENTS', `Failed to fetch auth events: ${getErrorMessage(error)}`);
  }
}); 