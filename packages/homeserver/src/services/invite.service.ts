import { Inject, Injectable } from '@nestjs/common';
import { generateId } from '../authentication';
import { MatrixError } from '../errors';
import { makeSignedRequest } from '../makeRequest';
import { EventBase } from '../models/event.model';
import { getPublicKeyFromRemoteServer, makeGetPublicKeyFromServerProcedure } from '../procedures/getPublicKeyFromServer';
import { checkSignAndHashes } from '../utils/checkSignAndHashes';
import { Logger } from '../utils/logger';
import { ConfigService } from './config.service';
import { EventService } from './event.service';
import { RoomService } from './room.service';
import { ServerService } from './server.service';

const logger = new Logger('InviteService');

interface MatrixEvent extends EventBase {
  origin: string;
}

type MakeJoinResponse = {
  event: any;
};

type SendJoinResponse = {
  state: any[];
  auth_chain: any[];
  event?: any;
};

@Injectable()
export class InviteService {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(EventService) private readonly eventService: EventService,
    @Inject(ServerService) private readonly serverService: ServerService,
    @Inject(RoomService) private readonly roomService: RoomService,
  ) {}

  async processInvite(event: any): Promise<any> {
    logger.info(`Processing invite for room ${event.room_id} from ${event.sender} to ${event.state_key}`);
    
    try {
      await this.eventService.insertEvent(event);
      logger.info(`Successfully stored invite event for ${event.state_key}`);
      
      // Process the invite asynchronously
      setTimeout(async () => {
        try {
          await this.handleInviteProcessing(event);
        } catch (error: any) {
          logger.error(`Error in async invite processing: ${error.message}`);
        }
      }, 1000);

      return { event };
    } catch (error: any) {
      logger.error(`Failed to process invite: ${error.message}`);
      throw error;
    }
  }

  private async handleInviteProcessing(event: any): Promise<void> {
    try {
      logger.info(`Starting invite processing for ${event.state_key} in room ${event.room_id}`);
      
      const signingKey = await this.configService.getSigningKey();
      logger.info(`Loaded signing key for server ${this.configService.getServerConfig().name}`);
      
      const serverConfig = this.configService.getServerConfig();

      // Step 1: Make a join request to get the join event template
      logger.info(`Making join request to ${event.origin} for room ${event.room_id}`);
      const responseMake = await makeSignedRequest({
        method: 'GET',
        domain: event.origin,
        uri: `/_matrix/federation/v1/make_join/${event.room_id}/${event.state_key}` as any,
        signingKey: signingKey[0],
        signingName: serverConfig.name,
        queryString: 'ver=10',
      }) as MakeJoinResponse;

      logger.info(`Received make_join response for ${event.state_key}`);

      // Step 2: Send the join event
      logger.info(`Sending join event to ${event.origin} for room ${event.room_id}`);
      const responseBody = await makeSignedRequest({
        method: 'PUT',
        domain: event.origin,
        uri: `/_matrix/federation/v2/send_join/${event.room_id}/${event.state_key}` as any,
        body: {
          ...responseMake.event,
          origin: serverConfig.name,
          origin_server_ts: Date.now(),
          depth: responseMake.event.depth + 1,
        },
        signingKey: signingKey[0],
        signingName: serverConfig.name,
        queryString: 'omit_members=false',
      }) as SendJoinResponse;

      logger.info(`Received send_join response for ${event.state_key}`);

      // Step 3: Validate the response
      const createEvent = responseBody.state.find((e: any) => e.type === 'm.room.create');
      if (!createEvent) {
        throw new MatrixError('400', 'Invalid response: missing m.room.create event');
      }

      logger.info(`Found create event for room ${event.room_id}`);

      if (responseBody.event) {
        await this.eventService.insertEvent(responseBody.event);
        logger.info(`Stored join event for ${event.state_key}`);
      }

      // Step 4: Process auth chain and state
      logger.info(`Processing auth chain with ${responseBody.auth_chain.length} events and state with ${responseBody.state.length} events`);
      
      const auth_chain = new Map(
        responseBody.auth_chain.map((e: any) => [generateId(e), e])
      );
      const state = new Map(
        responseBody.state.map((e: any) => [generateId(e), e])
      );

      // Step 5: Setup public key retrieval function
      logger.info(`Setting up public key retrieval function`);
      const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
        this.serverService.getValidPublicKeyFromLocal,
        (origin: string, key: string) => getPublicKeyFromRemoteServer(origin, serverConfig.name, key),
        this.serverService.storePublicKey
      );

      // Step 6: Validate PDUs
      logger.info(`Validating ${auth_chain.size + state.size} PDUs`);
      const validPDUs = new Map<string, MatrixEvent>();
      let validCount = 0;
      let invalidCount = 0;
      
      for await (const [eventId, pduEvent] of [...auth_chain.entries(), ...state.entries()]) {
        try {
          const isValid = await checkSignAndHashes(
            pduEvent as any,
            (pduEvent as any).origin,
            getPublicKeyFromServer
          );

          if (isValid) {
            validPDUs.set(eventId as string, pduEvent as MatrixEvent);
            validCount++;
          } else {
            logger.warn(`Invalid event ${eventId} of type ${pduEvent.type}`);
            invalidCount++;
          }
        } catch (e: any) {
          logger.error(`Error checking signature for event ${eventId}: ${e.message}`);
          invalidCount++;
        }
      }
      
      logger.info(`Validated PDUs: ${validCount} valid, ${invalidCount} invalid`);

      // Step 7: Get the create event
      const signedCreateEvent = [...validPDUs.entries()].find(
        ([, eventData]) => eventData.type === 'm.room.create'
      );

      if (!signedCreateEvent) {
        throw new MatrixError('400', 'Unexpected create event(s) in auth chain');
      }

      logger.info(`Found signed create event: ${signedCreateEvent[0]}`);

      // Step 8: Upsert room and events
      logger.info(`Upserting room ${signedCreateEvent[1].room_id} with ${validPDUs.size} events`);
      await this.roomService.upsertRoom(
        signedCreateEvent[1].room_id,
        [...validPDUs.values()]
      );

      logger.info(`Storing ${validPDUs.size} events in the event repository`);
      await Promise.all([...validPDUs.entries()].map(([_, eventData]) => this.eventService.insertEvent(eventData)));
      
      logger.info(`Successfully processed invite for ${event.state_key} in room ${event.room_id}`);
    } catch (error: any) {
      logger.error(`Error processing invite for ${event?.state_key} in room ${event?.room_id}: ${error.message}`);
      throw error;
    }
  }
} 