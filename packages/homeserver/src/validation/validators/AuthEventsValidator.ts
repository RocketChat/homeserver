import { createValidator, success, failure } from '../Validator';
import { CanonicalizedEvent, AuthorizedEvent } from './index';
import { Logger } from '../../routes/federation/logger';
import { extractOrigin } from '../../utils/extractOrigin';
import { generateId } from '../../authentication';
import { authorizationHeaders, computeAndMergeHash } from '../../authentication';
import { resolveHostAddressByServerName } from '../../helpers/server-discovery/discovery';
import { extractURIfromURL } from '../../helpers/url';
import { signJson } from '../../signJson';
import type { EventStore } from '../../plugins/mongodb';
import type { Config } from '../../plugins/config';
import type { SigningKey } from '../../keys';

const logger = new Logger("AuthEventsValidator");

async function makeFederationRequest(
  method: string,
  domain: string,
  uri: string,
  signingName: string,
  signingKey: SigningKey,
  body?: any
): Promise<any> {
  try {
    const { address, headers } = await resolveHostAddressByServerName(
      domain,
      signingName
    );
    
    const url = new URL(`https://${address}${uri}`);
    logger.debug(`Making ${method} request to ${url.toString()}`);
    
    const signedBody = body ? 
      await signJson(
        computeAndMergeHash({ ...body, signatures: {} }),
        signingKey,
        signingName
      ) : undefined;
    
    const auth = await authorizationHeaders(
      signingName,
      signingKey,
      domain,
      method,
      extractURIfromURL(url),
      signedBody
    );
    
    const response = await fetch(url.toString(), {
      method,
      ...(signedBody && { body: JSON.stringify(signedBody) }),
      headers: {
        Authorization: auth,
        ...headers
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Federation request failed with status ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (error: any) {
    logger.error(`Federation request failed: ${error.message || String(error)}`);
    throw error;
  }
}

async function fetchEventsFromRemoteServer(
  missingEvents: string[], 
  origin: string, 
  roomId: string,
  config: Config
): Promise<any[]> {
  try {
    logger.debug(`Fetching ${missingEvents.length} events from ${origin} for room ${roomId}`);
    
    const fetchedEvents: any[] = [];
    const attemptedEventIds = new Set<string>();
    
    try {
      const response = await makeFederationRequest(
        'POST',
        origin, 
        `/_matrix/federation/v1/get_missing_events/${roomId}`,
        config.name,
        config.signingKey[0],
        {
          earliest_events: [],
          latest_events: missingEvents,
          limit: missingEvents.length,
          min_depth: 0
        }
      );
      
      logger.debug(`Response from get_missing_events: ${JSON.stringify(response)}`);
      
      if (response && response.events && Array.isArray(response.events) && response.events.length > 0) {
        for (const event of response.events) {
          const eventId = generateId(event);
          attemptedEventIds.add(eventId);
          fetchedEvents.push(event);
        }
      }
    } catch (error) {
      const bulkError = error as Error;
      logger.warn(`Bulk fetch error: ${bulkError.message}, trying individual fetches`);
    }
    
    const remainingEvents = missingEvents.filter(id => !attemptedEventIds.has(id));
    
    if (remainingEvents.length > 0) {
      logger.debug(`Attempting individual event fetches for ${remainingEvents.length} remaining events`);
      
      for (const eventId of remainingEvents) {
        try {
          const response = await makeFederationRequest(
            'GET',
            origin,
            `/_matrix/federation/v1/event/${eventId}`,
            config.name,
            config.signingKey[0]
          );
          
          logger.debug(`Individual fetch response for ${eventId}: ${JSON.stringify(response)}`);
          
          if (response) {
            if (response.pdus && response.pdus[0]) {
              fetchedEvents.push(response.pdus[0]);
              attemptedEventIds.add(eventId);
            } else if (response.event) {
              fetchedEvents.push(response.event);
              attemptedEventIds.add(eventId);
            }
          }
        } catch (error) {
          logger.error(`Failed to fetch individual event ${eventId}: ${error}`);
        }
      }
    }
    
    const stillMissingEvents = missingEvents.filter(id => !attemptedEventIds.has(id));
    
    if (stillMissingEvents.length > 0) {
      logger.debug(`Trying alternative fetching method for ${stillMissingEvents.length} events`);
      
      try {
        const response = await makeFederationRequest(
          'GET',
          origin,
          `/_matrix/federation/v1/state/${roomId}`,
          config.name,
          config.signingKey[0]
        );
        
        logger.debug(`Room state query response contains ${response?.pdus?.length || 0} events`);
        
        if (response && response.pdus) {
          for (const event of response.pdus) {
            const eventId = generateId(event);
            if (stillMissingEvents.includes(eventId)) {
              fetchedEvents.push(event);
              attemptedEventIds.add(eventId);
            }
          }
        }
      } catch (error) {
        logger.error(`Failed to fetch room state: ${error}`);
      }
    }
    
    const finalMissingEvents = missingEvents.filter(id => !attemptedEventIds.has(id));
    if (finalMissingEvents.length > 0 && fetchedEvents.length > 0) {
      const referenceEvent = fetchedEvents[0];
      const referenceEventId = generateId(referenceEvent);
      
      logger.debug(`Trying context fetching using reference event ${referenceEventId}`);
      
      try {
        const response = await makeFederationRequest(
          'GET',
          origin,
          `/_matrix/federation/v1/context/${roomId}/${referenceEventId}?limit=100`,
          config.name,
          config.signingKey[0]
        );
        
        if (response) {
          const checkEvents = [
            ...(response.events_before || []), 
            ...(response.events_after || [])
          ];
          
          for (const event of checkEvents) {
            const eventId = generateId(event);
            if (finalMissingEvents.includes(eventId)) {
              fetchedEvents.push(event);
              attemptedEventIds.add(eventId);
            }
          }
        }
      } catch (error) {
        logger.error(`Failed to fetch event context: ${error}`);
      }
    }
    
    logger.debug(`Retrieved ${fetchedEvents.length}/${missingEvents.length} events in total`);
    return fetchedEvents;
  } catch (error: any) {
    logger.error(`Error fetching events from ${origin}: ${error.message || String(error)}`);
    if (error.stack) {
      logger.debug(`Error stack: ${error.stack}`);
    }
    return [];
  }
}

export const fetchAuthEvents = createValidator<CanonicalizedEvent, AuthorizedEvent>(async function(this: any, event: CanonicalizedEvent, _: string, eventId: string, context: any) {
  try {
    logger.debug(`Fetching auth events for event ${eventId}`);
    
    const { upsertEvent, getEventsByIds } = context.mongo;
    
    const authEventIds = event.event.auth_events || [];
    if (authEventIds.length === 0) {
      logger.warn(`Event ${eventId} has no auth events`);
      return failure('M_MISSING_AUTH_EVENTS', 'Event has no auth events');
    }

    logger.debug(`Checking for locally available auth events: ${authEventIds.join(', ')}`);
    const existingEvents = await getEventsByIds(event.event.room_id, authEventIds);
    const existingEventMap = new Map<string, EventStore>(existingEvents.map((e: EventStore) => [e._id, e]));
    const missingEventIds = authEventIds.filter((id: string) => !existingEventMap.has(id));
    if (missingEventIds.length === 0) {
      logger.debug(`All auth events found locally for ${eventId}`);
      
      const authEventObjects = existingEvents.map((storedEvent: EventStore) => ({
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
    
    logger.debug(`Need to fetch ${missingEventIds.length} missing auth events from remote: ${missingEventIds.join(', ')}`);
    
    const origin = extractOrigin(event.event.sender);
    const roomId = event.event.room_id;
    
    try {
      logger.debug(`Fetching missing auth events from origin: ${origin}`);
      
      const fetchedEvents = await fetchEventsFromRemoteServer(missingEventIds, origin, roomId, context.config);
      
      if (fetchedEvents.length === 0) {
        logger.error(`Failed to fetch any auth events from ${origin}`);
        return failure('M_MISSING_AUTH_EVENTS', `Failed to fetch required auth events from remote server ${origin}`);
      }
      
      await Promise.all(
        fetchedEvents.map(async (fetchedEvent) => {
          try {
            const fetchedEventId = await upsertEvent(fetchedEvent);
            logger.debug(`Upserted event: ${fetchedEventId}`);
            
            existingEventMap.set(fetchedEventId, { 
              _id: fetchedEventId, 
              event: fetchedEvent 
            } as EventStore);
          } catch (error: any) {
            logger.error(`Error upserting event: ${error.message || String(error)}`);
            throw error;
          }
        })
      );
      
      logger.debug(`Processed ${fetchedEvents.length} fetched events for database storage`);
      
      const stillMissingIds = authEventIds.filter((id: string) => !existingEventMap.has(id));
      
      if (stillMissingIds.length > 0) {
        logger.warn(`Still missing ${stillMissingIds.length} auth events after fetching: ${stillMissingIds.join(', ')}`);
        
        const criticalEvents = [];
        let createEventFound = false;
        let powerLevelsEventFound = false;
        
        for (const [id, event] of existingEventMap.entries()) {
          if (event.event.type === 'm.room.create' && event.event.state_key === '') {
            createEventFound = true;
          } else if (event.event.type === 'm.room.power_levels' && event.event.state_key === '') {
            powerLevelsEventFound = true;
          }
        }
        
        if (!createEventFound) {
          logger.error(`Missing required create event for room ${roomId}`);
          return failure('M_MISSING_AUTH_EVENTS', `Failed to retrieve required auth events: ${stillMissingIds.join(', ')}`);
        }
        
        if (stillMissingIds.length <= authEventIds.length * 0.25) {  // Missing at most 25% of auth events
          logger.warn(`Proceeding with incomplete auth chain - missing ${stillMissingIds.length} of ${authEventIds.length} auth events`);
          
          const authEventObjects = [];
          for (const id of authEventIds) {
            const storedEvent = existingEventMap.get(id);
            if (storedEvent) {
              authEventObjects.push({
                event: storedEvent.event
              });
            }
          }
          
          return success({
            event: event.event,
            canonicalizedEvent: event.canonicalizedEvent,
            authorizedEvent: {
              auth_events: authEventIds,
              auth_event_objects: authEventObjects,
              signatures: event.event.signatures,
              hashes: event.event.hashes,
              incomplete_chain: true
            }
          });
        }
        
        return failure('M_MISSING_AUTH_EVENTS', `Failed to retrieve required auth events: ${stillMissingIds.join(', ')}`);
      }
      
      const allAuthEventObjects = authEventIds.map((id: string) => {
        const storedEvent = existingEventMap.get(id);
        if (!storedEvent) {
          throw new Error(`Missing event despite checks: ${id}`);
        }
        return {
          event: storedEvent.event
        };
      });
      
      logger.debug(`Successfully assembled all auth events for ${eventId}`);
      
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
      
    } catch (networkError: any) {
      logger.error(`Network error fetching auth events from ${origin}: ${networkError.message || String(networkError)}`);
      return failure('M_FAILED_TO_FETCH_AUTH', `Failed to fetch auth events: ${networkError.message || String(networkError)}`);
    }
  } catch (error: any) {
    logger.error(`Failed to fetch auth events for ${eventId}: ${error.message || String(error)}`);
    return failure('M_MISSING_AUTH_EVENTS', `Failed to fetch auth events: ${error.message || String(error)}`);
  }
}); 