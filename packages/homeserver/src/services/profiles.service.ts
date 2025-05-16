import { Injectable, Logger } from '@nestjs/common';
import { makeJoinEventBuilder } from '../procedures/makeJoin';
import { ConfigService } from './config.service';
import { EventService } from './event.service';
import { RoomService } from './room.service';

// Import EventStore from plugins/mongodb for type compatibility with makeJoinEventBuilder
import type { EventStore as MongoEventStore } from '../plugins/mongodb';

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly eventService: EventService,
    private readonly roomService: RoomService,
  ) {}

  async queryProfile(userId: string): Promise<{ avatar_url: string, displayname: string }> {
    return {
      avatar_url: "mxc://matrix.org/MyC00lAvatar",
      displayname: userId,
    };
  }

  async queryKeys(deviceKeys: Record<string, string>): Promise<any> {
    const keys = Object.keys(deviceKeys).reduce((v, cur) => {
      v[cur] = "unknown_key";
      return v;
    }, {} as any);

    return {
      device_keys: keys,
    };
  }

  async getDevices(userId: string): Promise<any> {
    return {
      user_id: userId,
      stream_id: 1,
      devices: [],
    };
  }

  async makeJoin(roomId: string, userId: string, version: string): Promise<any> {
    if (!userId.includes(":") || !userId.includes("@")) {
      throw new Error("Invalid sender");
    }
    if (!roomId.includes(":") || !roomId.includes("!")) {
      throw new Error("Invalid room Id");
    }

    // Adapt the EventService calls to match the signature expected by makeJoinEventBuilder
    const getAuthEvents = async (roomId: string): Promise<MongoEventStore[]> => {
      const authEvents = await this.eventService.getAuthEventsIdsForRoom(roomId);
      // Convert to the expected format
      return authEvents.map((event: string) => ({
        _id: event,
        event: {
          event_id: event,
          origin: '', // Add required property
        },
        staged: false,
      })) as unknown as MongoEventStore[];
    };

    const getLastEvent = async (roomId: string): Promise<MongoEventStore | null> => {
      const lastEvent = await this.eventService.getLastEventForRoom(roomId);
      if (!lastEvent) return null;
      
      // Convert to the expected format
      return {
        _id: lastEvent.event.event_id || '',
        event: {
          ...lastEvent.event,
          origin: '', // Add required property
        },
        staged: false,
      } as unknown as MongoEventStore;
    };

    const makeJoinEvent = makeJoinEventBuilder(getLastEvent, getAuthEvents);
    const serverName = this.configService.getServerConfig().name;
    
    // Convert version string to array if provided
    const versionArray = version ? [version] : ['1', '2', '9', '10'];
    
    return await makeJoinEvent(roomId, userId, versionArray, serverName);
  }

  async getMissingEvents(roomId: string, earliestEvents: string[], latestEvents: string[], limit: number): Promise<any> {
    const events = await this.eventService.getMissingEvents(roomId, earliestEvents, latestEvents, limit);
    return events;
  }

  async eventAuth(roomId: string, eventId: string): Promise<any> {
    return {
      auth_chain: [],
    };
  }
} 