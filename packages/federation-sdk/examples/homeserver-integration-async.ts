import { Injectable, Module } from '@nestjs/common';
import { FederationModule } from '../src/federation.module';
import { FederationService } from '../src/services/federation.service';

// Example custom config service
@Injectable()
export class ConfigService {
  // Simulating how you might have config values in your application
  private config = {
    server: {
      name: 'your-server.com',
    },
    keys: {
      signingKey: 'YOUR_SIGNING_KEY_BASE64',
      signingKeyId: 'ed25519:1',
    },
    federation: {
      timeout: 30000,
    },
  };

  getServerName(): string {
    return this.config.server.name;
  }

  getSigningKey(): string {
    return this.config.keys.signingKey;
  }

  getSigningKeyId(): string {
    return this.config.keys.signingKeyId;
  }

  getFederationTimeout(): number {
    return this.config.federation.timeout;
  }
}

// Example of importing the FederationModule in a NestJS application using async config
@Module({
  imports: [
    // First, ensure ConfigModule is imported and provides the ConfigService
    // ConfigModule.forRoot({ ... }),

    // Then use FederationModule.forRootAsync to dynamically configure the module
    FederationModule.forRootAsync({
      // Inject your ConfigService
      inject: [ConfigService],
      // Use factory function to return configuration from your ConfigService
      useFactory: (configService: ConfigService) => ({
        serverName: configService.getServerName(),
        signingKey: configService.getSigningKey(),
        signingKeyId: configService.getSigningKeyId(),
        timeout: configService.getFederationTimeout(),
      }),
    }),
    // ... other modules
  ],
  providers: [
    // Make sure ConfigService is provided somewhere in your app
    ConfigService,
  ],
  // ... controllers, etc.
})
export class HomeServerModule {}

// Example of using FederationService in a service with async configuration
@Injectable()
export class InviteService {
  constructor(
    private readonly federationService: FederationService,
    private readonly configService: ConfigService,
  ) {}

  async processInvite(event: any): Promise<unknown> {
    try {
      const remoteDomain = event.origin;
      const roomId = event.room_id;
      const userId = event.state_key;

      // Get room version from your config
      const roomVersion = '10'; // This could come from configService

      // Step 1: Make a join request
      const makeJoinResponse = await this.federationService.makeJoin(
        remoteDomain, 
        roomId, 
        userId, 
        roomVersion
      );

      // Step 2: Send the join event
      const sendJoinResponse = await this.federationService.sendJoin(
        remoteDomain,
        roomId,
        userId,
        makeJoinResponse.event,
        false // omit_members flag
      );

      // Process response...
      
      return { success: true };
    } catch (error: any) {
      // Handle errors
      throw error;
    }
  }
} 