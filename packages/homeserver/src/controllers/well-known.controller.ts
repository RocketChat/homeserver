import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '../services/config.service';
import { Logger } from '../utils/logger';

const logger = new Logger('WellKnownController');

@Controller('/.well-known/matrix/server')
export class WellKnownController {
	constructor(private readonly configService: ConfigService) {}

	@Get()
	async server(@Res() response: Response) {
        const responseData = {
            'm.server': `${this.configService.getServerConfig().name}:443`,
        };

        try {
            const etag = new Bun.CryptoHasher('md5')
                .update(JSON.stringify(responseData))
                .digest('hex');

            console.log(etag);

            response.setHeader('ETag', etag);
            response.setHeader('Content-Type', 'application/json');
            
            return responseData;
        } catch (error) {
            logger.error(error);
            return Promise.reject({ error: 'Internal server error' });
        }
	}
}
