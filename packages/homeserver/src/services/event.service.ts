import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { z } from 'zod';
import { generateId } from '../authentication';
import { MatrixError } from '../errors';
import { EventBase, EventStore } from '../models/event.model';
import { getPublicKeyFromRemoteServer, makeGetPublicKeyFromServerProcedure } from '../procedures/getPublicKeyFromServer';
import { EventRepository } from '../repositories/event.repository';
import { KeyRepository } from '../repositories/key.repository';
import { RoomRepository } from '../repositories/room.repository';
import { checkSignAndHashes } from '../utils/checkSignAndHashes';
import { Logger } from '../utils/logger';
import { eventSchemas } from '../validation/schemas/event-schemas';
import { roomV10Type } from '../validation/schemas/room-v10.type';
import { ConfigService } from './config.service';
import { StagingAreaService } from './staging-area.service';

type ValidationResult = {
  eventId: string;
  event: roomV10Type;
  valid: boolean;
  error?: {
    errcode: string;
    error: string;
  };
};

@Injectable()
export class EventService {
  private readonly logger = new Logger('EventService');

  constructor(
    @Inject(EventRepository) private readonly eventRepository: EventRepository,
    @Inject(RoomRepository) private readonly roomRepository: RoomRepository,
    @Inject(KeyRepository) private readonly keyRepository: KeyRepository,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(forwardRef(() => StagingAreaService)) private readonly stagingAreaService: StagingAreaService
  ) {}
  
  async checkIfEventsExists(eventIds: string[]): Promise<{ missing: string[], found: string[] }> {
    const events: Pick<EventStore, "_id">[] = await this.eventRepository.find({ _id: { $in: eventIds } }, { projection: { _id: 1 } });
    
    return eventIds.reduce((acc: { missing: string[], found: string[] }, id) => {
      const event = events.find((event) => event._id === id);
      
      if (event) {
        acc.found.push(event._id);
      } else {
        acc.missing.push(id);
      }
      
      return acc;
    }, { missing: [], found: [] });
  }

  async processIncomingPDUs(events: roomV10Type[]) {
    const eventsWithIds = events.map((event) => {
      const eventId = generateId(event);
      return { 
        eventId,
        event,
        valid: true
      };
    });
    
    this.logger.debug(`Processing ${eventsWithIds.length} incoming PDUs`);
    
    const validatedEvents: ValidationResult[] = [];
    
    for (const event of eventsWithIds) {
      // Step 1: Validate event format
      let result = await this.validateEventFormat(event.eventId, event.event);
      
      // Step 2: If format is valid, validate event type-specific rules
      if (result.valid) {
        result = await this.validateEventTypeSpecific(event.eventId, event.event);
      }
      
      // Step 3: If event type is valid, validate signatures and hashes
      if (result.valid) {
        result = await this.validateSignaturesAndHashes(event.eventId, event.event);
      }
      
      validatedEvents.push(result);
    }
    
    for (const event of validatedEvents) {
      if (!event.valid) {
        this.logger.warn(`Validation failed for event ${event.eventId}: ${event.error?.errcode} - ${event.error?.error}`);
        continue;
      }
      
      // Add successful events to the staging area for async processing
      this.logger.debug(`Adding validated event ${event.eventId} to staging area queue`);
      this.stagingAreaService.addEventToQueue({
        eventId: event.eventId,
        roomId: event.event.room_id,
        origin: event.event.origin || '',
        event: event.event,
      });
    }
  }

  private async validateEventFormat(eventId: string, event: roomV10Type): Promise<ValidationResult> {
    try {
      const roomVersion = await this.getRoomVersion(event);
      if (!roomVersion) {
        return {
          eventId,
          event,
          valid: false,
          error: {
            errcode: 'M_UNKNOWN_ROOM_VERSION',
            error: 'Could not determine room version for event'
          }
        };
      }

      const eventSchema = this.getEventSchema(roomVersion, event.type);
      const validationResult = eventSchema.safeParse(event);
      
      if (!validationResult.success) {
        const formattedErrors = JSON.stringify(validationResult.error.format());
        this.logger.error(`Event ${eventId} failed schema validation: ${formattedErrors}`);
        
        return {
          eventId,
          event,
          valid: false,
          error: {
            errcode: 'M_SCHEMA_VALIDATION_FAILED',
            error: `Schema validation failed: ${formattedErrors}`
          }
        };
      }

      this.logger.debug(`Event ${eventId} passed schema validation for room version ${roomVersion}`);
      return { eventId, event, valid: true };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      this.logger.error(`Error validating format for ${eventId}: ${errorMessage}`);
      
      return {
        eventId,
        event,
        valid: false,
        error: {
          errcode: 'M_FORMAT_VALIDATION_ERROR',
          error: `Error validating format: ${errorMessage}`
        }
      };
    }
  }

  private async validateEventTypeSpecific(eventId: string, event: roomV10Type): Promise<ValidationResult> {
    try {
      if (event.type === 'm.room.create') {
        const errors = this.validateCreateEvent(event);
        
        if (errors.length > 0) {
          this.logger.error(`Create event ${eventId} validation failed: ${errors.join(', ')}`);
          return {
            eventId,
            event,
            valid: false,
            error: {
              errcode: 'M_INVALID_CREATE_EVENT',
              error: `Create event validation failed: ${errors[0]}`
            }
          };
        }
      } else {
        const errors = this.validateNonCreateEvent(event);
        
        if (errors.length > 0) {
          this.logger.error(`Event ${eventId} validation failed: ${errors.join(', ')}`);
          return {
            eventId,
            event,
            valid: false,
            error: {
              errcode: 'M_INVALID_EVENT',
              error: `Event validation failed: ${errors[0]}`
            }
          };
        }
      }
      
      this.logger.debug(`Event ${eventId} passed type-specific validation`);
      return { eventId, event, valid: true };
    } catch (error: any) {
      this.logger.error(`Error in type-specific validation for ${eventId}: ${error.message || String(error)}`);
      return {
        eventId,
        event,
        valid: false,
        error: {
          errcode: 'M_TYPE_VALIDATION_ERROR',
          error: `Error in type-specific validation: ${error.message || String(error)}`
        }
      };
    }
  }

  private async validateSignaturesAndHashes(eventId: string, event: roomV10Type): Promise<ValidationResult> {
    try {
      const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
        (origin, keyId) => this.keyRepository.getValidPublicKeyFromLocal(origin, keyId),
        (origin, key) => getPublicKeyFromRemoteServer(origin, this.configService.getServerName(), key),
        (origin, keyId, publicKey) => this.keyRepository.storePublicKey(origin, keyId, publicKey),
      );

      await checkSignAndHashes(event, event.origin, getPublicKeyFromServer);
      return { eventId, event, valid: true };
    } catch (error: any) {
      this.logger.error(`Error validating signatures for ${eventId}: ${error.message || String(error)}`);
      return {
        eventId,
        event,
        valid: false,
        error: {
          errcode: error instanceof MatrixError ? error.errcode : 'M_UNKNOWN',
          error: error.message || String(error)
        }
      };
    }
  }

  private validateCreateEvent(event: any): string[] {
    const errors: string[] = [];
    
    if (event.prev_events && event.prev_events.length > 0) {
      errors.push('Create event must not have prev_events');
    }
    
    if (event.room_id && event.sender) {
      const roomDomain = this.extractDomain(event.room_id);
      const senderDomain = this.extractDomain(event.sender);
      
      if (roomDomain !== senderDomain) {
        errors.push(`Room ID domain (${roomDomain}) does not match sender domain (${senderDomain})`);
      }
    }
    
    if (event.auth_events && event.auth_events.length > 0) {
      errors.push('Create event must not have auth_events');
    }
    
    if (!event.content || !event.content.room_version) {
      errors.push('Create event must specify a room_version');
    } else {
      const validRoomVersions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
      if (!validRoomVersions.includes(event.content.room_version)) {
        errors.push(`Unsupported room version: ${event.content.room_version}`);
      }
    }
    
    return errors;
  }
  
  private validateNonCreateEvent(event: any): string[] {
    const errors: string[] = [];
    
    if (!event.prev_events || !Array.isArray(event.prev_events) || event.prev_events.length === 0) {
      errors.push('Event must reference previous events (prev_events)');
    }
    
    return errors;
  }
  
  private extractDomain(id: string): string {
    const parts = id.split(':');
    return parts.length > 1 ? parts[1] : '';
  }

  private async getRoomVersion(event: roomV10Type): Promise<string | null> {
    if (event.type === 'm.room.create' && event.state_key === '') {
      const roomVersion = event.content?.room_version;
      if (roomVersion) {
        this.logger.debug(`Extracted room version ${roomVersion} from create event`);
        return roomVersion as string;
      }
    }
    
    const cachedRoomVersion = await this.roomRepository.getRoomVersion(event.room_id);
    if (cachedRoomVersion) {
      this.logger.debug(`Using cached room version ${cachedRoomVersion} for room ${event.room_id}`);
      return cachedRoomVersion;
    }

    this.logger.warn(`Could not determine room version for ${event.room_id}, using default version 10`);
    return "10";
  }

  private getEventSchema(roomVersion: string, eventType: string): z.ZodSchema {
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

  async insertEvent(event: EventBase) {
    await this.eventRepository.create(event);
  }
  
  async getAuthEventsForRoom(roomId: string): Promise<EventBase[]> {
    const authEvents = await this.eventRepository.find(
      {
        'event.room_id': roomId,
        'event.type': { $in: ['m.room.create', 'm.room.join_rules', 'm.room.power_levels', 'm.room.member'] }
      },
      {}
    );
    
    return authEvents.map(event => event.event);
  }
  
  async getLastEventForRoom(roomId: string): Promise<EventStore | null> {
    return this.eventRepository.findLatestInRoom(roomId);
  }
  
  async getMissingEvents(
    roomId: string, 
    earliestEvents: string[], 
    latestEvents: string[], 
    limit: number
  ): Promise<EventBase[]> {
    // This is a simplified implementation; the real one would need to query events 
    // between earliestEvents and latestEvents based on their depths
    const events = await this.eventRepository.find(
      {
        'event.room_id': roomId,
        '_id': { $nin: [...earliestEvents, ...latestEvents] }
      }, 
      { limit }
    );
    
    return events.map(event => event.event);
  }

  async getEventsByIds(eventIds: string[]): Promise<{ _id: string, event: EventBase }[]> {
    if (!eventIds || eventIds.length === 0) {
      return [];
    }
    
    this.logger.debug(`Retrieving ${eventIds.length} events by IDs`);
    const events = await this.eventRepository.find({ _id: { $in: eventIds } });
    
    return events.map(event => ({
      _id: event._id,
      event: event.event
    }));
  }
} 
