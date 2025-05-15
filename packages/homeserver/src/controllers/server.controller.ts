import { Controller, Get } from '@nestjs/common';
import { toUnpaddedBase64 } from '../binaryData';
import { SigningKey } from '../keys';
import { ConfigService } from '../services/config.service';
import { signJson } from '../signJson';
import { Logger } from '../utils/logger';

const logger = new Logger('ServerController');

@Controller('/_matrix/key/v2')
export class ServerController {
    constructor(private readonly configService: ConfigService) {}

    @Get("/server")
    async server() {
        try {
            logger.info('Handling server key request');
            const config = this.configService.getConfig();
            const signingKeys = await this.configService.getSigningKey();
            
            logger.info(`Retrieved ${signingKeys.length} signing keys`);
            
            // Create verify_keys object from signing keys
            const keys = Object.fromEntries(
                signingKeys.map((signingKey: SigningKey) => [
                    `${signingKey.algorithm}:${signingKey.version}`,
                    {
                        key: toUnpaddedBase64(signingKey.publicKey),
                    },
                ]),
            );
            
            logger.info('Created verify_keys object');

            // Build the response and sign it
            const baseResponse = {
                old_verify_keys: {},
                server_name: config.server.name,
                signatures: {},
                valid_until_ts: new Date().getTime() + 60 * 60 * 24 * 1000, // 1 day
                verify_keys: keys,
            };
            
            logger.info('Signing response');
            
            // Sign the response with each signing key
            let signedResponse = baseResponse;
            for (const key of signingKeys) {
                signedResponse = await signJson(signedResponse, key, config.server.name);
            }
            
            logger.info('Successfully signed server key response');
            return signedResponse;
            
        } catch (error: any) {
            logger.error(`Error in server key endpoint: ${error.message}`);
            throw error;
        }
    }
}