import { Inject, Injectable } from '@nestjs/common';
import { FederationClient } from '../../../federation-sdk/src';
import { EventBase } from '../models/event.model';
import { Logger } from '../utils/logger';
import { ConfigService } from './config.service';

@Injectable()
export class FederationService {
  private readonly logger = new Logger('FederationService');
  private federationClient: FederationClient | null = null;
  
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {
    // Initialize the federation client asynchronously
    this.initFederationClient().catch(err => {
      this.logger.error(`Failed to initialize federation client: ${err.message}`);
    });
  }

  private async initFederationClient() {
    try {
      // Get the signing key from the config service
      const signingKeys = await this.configService.getSigningKey();
      const signingKey = Array.isArray(signingKeys) ? signingKeys[0] : signingKeys;

      // Key has sign method, use it directly
      this.federationClient = new FederationClient({
        serverName: this.configService.getServerName(),
        signingKey,
        debug: this.configService.isDebugEnabled()
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize federation client: ${errorMessage}`);
      throw error;
    }
  }

  async sendEventToServers(roomId: string, event: EventBase): Promise<void> {
    // Initialize client if it's not already initialized
    if (!this.federationClient) {
      await this.initFederationClient();
    }
    
    this.logger.debug(`Federating event ${event.event_id || 'unknown'} to other servers in room ${roomId}`);
    
    // In a real implementation, this would:
    // 1. Get the list of servers in the room
    // 2. Send the event to each server using the federation API
    
    // For now, just log it
    this.logger.debug(`Event ${event.event_id || 'unknown'} federated to room ${roomId}`);
  }
} 