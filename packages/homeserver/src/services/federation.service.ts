import { Inject, Injectable } from '@nestjs/common';
import { FederationClient } from '../../../federation-sdk/src';
import { EventBase } from '../models/event.model';
import { Logger } from '../utils/logger';
import { ConfigService } from './config.service';

@Injectable()
export class FederationService {
  private readonly logger = new Logger('FederationService');
  private readonly federationClient: FederationClient;
  
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {
    this.federationClient = new FederationClient({
      serverName: this.configService.getServerName(),
      signingKey: this.configService.getSigningKey(),
      debug: this.configService.isDebugEnabled()
    });
  }

  async sendEventToServers(roomId: string, event: EventBase): Promise<void> {
    this.logger.debug(`Federating event ${event.event_id || 'unknown'} to other servers in room ${roomId}`);
    
    // In a real implementation, this would:
    // 1. Get the list of servers in the room
    // 2. Send the event to each server using the federation API
    
    // For now, just log it
    this.logger.debug(`Event ${event.event_id || 'unknown'} federated to room ${roomId}`);
  }
} 