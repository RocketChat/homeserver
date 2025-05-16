import { Module } from '@nestjs/common';
import { FederationModule } from '../src/federation.module';

// Example of importing the FederationModule in a NestJS application
@Module({
  imports: [
    FederationModule.forRoot({
      serverName: 'example.com',
      signingKey: 'YOUR_SIGNING_KEY_BASE64',
      signingKeyId: 'ed25519:1',
      timeout: 30000,
    }),
    // ... other modules
  ],
  // ... controllers, providers, etc.
})
export class HomeServerModule {}

// Example of using FederationService in a service
/*
import { Injectable } from '@nestjs/common';
import { FederationService } from '@hs/federation-sdk';

@Injectable()
export class InviteService {
  constructor(private readonly federationService: FederationService) {}

  async processInvite(event: any): Promise<unknown> {
    try {
      // Use federation service to handle the invite
      const remoteDomain = event.origin;
      const roomId = event.room_id;
      const userId = event.state_key;

      // Step 1: Make a join request to get the join event template
      const makeJoinResponse = await this.federationService.makeJoin(
        remoteDomain, 
        roomId, 
        userId, 
        '10' // room version
      );

      // Step 2: Send the join event
      const sendJoinResponse = await this.federationService.sendJoin(
        remoteDomain,
        roomId,
        userId,
        makeJoinResponse.event,
        false // omit_members flag
      );

      // Step 3: Validate PDUs
      for (const pdu of sendJoinResponse.state) {
        const isValid = await this.federationService.verifyPDU(pdu, pdu.origin);
        // Process valid PDUs...
      }

      return { success: true };
    } catch (error: any) {
      // Handle errors
      throw error;
    }
  }
}
*/ 