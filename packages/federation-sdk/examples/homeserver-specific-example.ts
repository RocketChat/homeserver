import { Module } from '@nestjs/common';
import { ConfigService } from '../../homeserver/src/services/config.service';
import { FederationModule } from '../src/federation.module';

/**
 * Example of how to import the FederationModule in the HomeServerModule
 * using the existing ConfigService
 */
@Module({
  imports: [
    // Use the FederationModule with your existing ConfigService
    FederationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        // Get signing key - this returns an array of key pairs
        const signingKeys = await configService.getSigningKey();
        const signingKey = signingKeys[0]; // Use the first key

        // Convert the privateKey (Uint8Array) to base64 string
        const privateKeyBase64 = Buffer.from(signingKey.privateKey).toString('base64');

        return {
          // Use values from your Matrix configuration
          serverName: configService.getMatrixConfig().serverName,
          // Use the private key as a base64 string
          signingKey: privateKeyBase64,
          // Use the algorithm and version to create a key ID
          signingKeyId: `${signingKey.algorithm}:${signingKey.version}`,
          // Set a reasonable timeout
          timeout: 30000,
        };
      },
    }),
    // ... other modules
  ],
  // ... controllers, providers, etc.
})
export class HomeServerModule {}

/**
 * Example of how to use this in your real app.module.ts:
 * 
 * @Module({
 *   imports: [
 *     // Import other necessary modules
 *     ConfigModule,
 *     DatabaseModule,
 *     // Import the Federation module with dynamic config
 *     FederationModule.forRootAsync({
 *       inject: [ConfigService],
 *       useFactory: async (configService: ConfigService) => {
 *         const signingKeys = await configService.getSigningKey();
 *         const signingKey = signingKeys[0];
 *         
 *         // Convert the privateKey to base64 string
 *         const privateKeyBase64 = Buffer.from(signingKey.privateKey).toString('base64');
 *         
 *         return {
 *           serverName: configService.getMatrixConfig().serverName,
 *           signingKey: privateKeyBase64,
 *           signingKeyId: `${signingKey.algorithm}:${signingKey.version}`,
 *           timeout: 30000,
 *         };
 *       },
 *     }),
 *   ],
 *   controllers: [],
 *   providers: [],
 * })
 * export class AppModule {}
 */ 