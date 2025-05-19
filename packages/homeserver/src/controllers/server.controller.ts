import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Param, Post, Res } from '@nestjs/common';
import { toUnpaddedBase64 } from '../binaryData';
import { SigningKey } from '../keys';
import { ConfigService } from '../services/config.service';
import { signJson } from '../signJson';
import { Logger } from '../utils/logger';
import { V2KeyQueryCriteria, V2KeyQueryBody, V2KeyQueryResponse } from '@hs/core/src/query';
import { ServerKey } from '@hs/core/src/server';
import { KeyService } from '../services/key.service';
import { ServerKeyDocument } from '../repositories/key.repository';
import { WithId } from 'mongodb';
import { HttpLoggerInterceptor } from '../middleware/http-logger.interceptor';
const logger = new Logger('ServerController');

@Controller('/_matrix/key/v2')
@Injectable()
export class ServerController {
    constructor(@Inject(ConfigService) private readonly configService: ConfigService,
		@Inject(KeyService) private readonly keyService: KeyService) {}

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
	
	@Post("/query")
	@HttpCode(HttpStatus.OK)
	async queryWithoutServerName(@Body() body: V2KeyQueryBody) {
		return this.handleQuery(body);
	}

	@Get("/query/:serverName")
	@HttpCode(HttpStatus.OK)
	async queryWithServerName(@Param("serverName") serverName: string) {
		const request = {server_keys : {
			[serverName]: {},
		}};
		return this.handleQuery(request);
	}

	private async handleQuery(body: V2KeyQueryBody): Promise<V2KeyQueryResponse> {
		const keys: WithId<ServerKeyDocument>[] = [];
		
		logger.info(`querying keys, ${JSON.stringify(body.server_keys)}`);

		for (const [serverName, request] of Object.entries(body.server_keys)) {
			const _keys = Object.keys(request);
			// if no explicit key requested
			if (_keys.length === 0) {
				logger.info(`no explicit key requested for ${serverName}, fetching all keys`);
				// no key and criteria, make sure resulting keys are not expired, compare against current time
				const key = await this.keyService.fetchKeys(serverName, { validUntil: Date.now() });
				keys.push(...key);
				continue;
			} 

			for (const keyId of _keys) {
				const criteria = request[keyId];
				logger.info(`fetching keys for ${serverName}, ${keyId}, ${criteria.minimum_valid_until_ts}`);
				const key = await this.keyService.fetchKeys(serverName, { keyId, validUntil: criteria.minimum_valid_until_ts });
				keys.push(...key);
			}
		}
		
		logger.info(`Fetched ${keys.length} keys, JSON: ${JSON.stringify(keys)}`);
		
		return {
			server_keys: await Promise.all(keys.map(async (key) => {
				const { signatures, _id, _createdAt, ...all } = key;
				const signed = await signJson(all, (await this.configService.getSigningKey())[0], this.configService.getServerName());
				return {
					...signed,
					signatures: {
						...signed.signatures,
						...signatures,
					},
				};
			}))
		}
	}
}