import { z } from 'zod';
import type { Config } from '../../plugins/config';
import { Validator } from '../decorators/validator.decorator';
import type { EventTypeArray, IPipeline } from '../pipelines';
import { eventSchemas } from '../schemas/event-schemas';

async function getCachedRoomVersion(roomId: string, context: any): Promise<string | null> {
  // TODO: Should load from an injected repository instead of passing in context
  if (!context.mongo?.getRoomVersion) {
    console.warn('No getRoomVersion method available');
    return null;
  }
  
  try {
    return await context.mongo.getRoomVersion(roomId);
  } catch (error) {
    console.error(`Error getting cached room version: ${error}`);
    return null;
  }
}

async function getRoomVersionFromOriginServer(origin: string, roomId: string, config: Config): Promise<string | null> {
  console.debug(`Fetching room version from origin server ${origin} for room ${roomId}`);
  return null;
}

async function extractRoomVersion(event: any, context: any): Promise<string | null> {
  if (event.type === 'm.room.create' && event.state_key === '') {
    const roomVersion = event.content?.room_version;
    if (roomVersion) {
      console.debug(`Extracted room version ${roomVersion} from create event`);
      return roomVersion;
    }
  }
  
  const cachedRoomVersion = await getCachedRoomVersion(event.room_id, context);
  if (cachedRoomVersion) {
    console.debug(`Using cached room version ${cachedRoomVersion} for room ${event.room_id}`);
    return cachedRoomVersion;
  }

  if (event.origin) {
    const originRoomVersion = await getRoomVersionFromOriginServer(event.origin, event.room_id, context.config);
    if (originRoomVersion) {
      console.debug(`Using origin server room version ${originRoomVersion} for room ${event.room_id}`);
      return originRoomVersion;
    }
  }

  console.warn(`Could not determine room version for ${event.room_id}, using default version 11`);
  return "11";
}

function getEventSchema(roomVersion: string, eventType: string): z.ZodSchema {
  const versionSchemas = eventSchemas[roomVersion];
  if (!versionSchemas) {
    throw new Error(`Unsupported room version: ${roomVersion}`);
  }
  
  const schema = versionSchemas[eventType] || versionSchemas.default;
  if (!schema) {
    throw new Error(`No schema available for event type ${eventType} in room version ${roomVersion}`);
  }
  
  return schema;
}

@Validator()
export class EventFormatValidator implements IPipeline<EventTypeArray> {
  async validate(events: EventTypeArray, context: any): Promise<EventTypeArray> {
    const response: EventTypeArray = [];

    for (const event of events) {
      const eventId = event.eventId;
      const eventType = event.event.type;

      console.debug(`Validating format for event ${eventId} of type ${eventType}`);

      try {
        const roomVersion = await extractRoomVersion(event.event, context);
        if (!roomVersion) {
          console.error(`Could not determine room version for event ${eventId}`);
          response.push({
            eventId,
            error: {
              errcode: 'M_UNKNOWN_ROOM_VERSION',
              error: 'Could not determine room version for event'
            },
            event: event.event
          });
          continue;
        }

        const eventSchema = getEventSchema(roomVersion, eventType);
        const validationResult = eventSchema.safeParse(event.event);
        if (!validationResult.success) {
          const formattedErrors = JSON.stringify(validationResult.error.format());
          console.error(`Event ${eventId} failed schema validation: ${formattedErrors}`);
          response.push({
            eventId,
            error: {
              errcode: 'M_SCHEMA_VALIDATION_FAILED',
              error: `Schema validation failed: ${formattedErrors}`
            },
            event: event.event
          });
          continue;
        }

        console.debug(`Event ${eventId} passed schema validation for room version ${roomVersion}`);
        response.push({
          eventId,
          event: event.event
        });
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        console.error(`Error validating format for ${eventId}: ${errorMessage}`);
        response.push({
          eventId,
          error: {
            errcode: 'M_FORMAT_VALIDATION_ERROR',
            error: `Error validating format: ${errorMessage}`
          },
          event: event.event
        });
      }
    }

    return response;
  }
}
