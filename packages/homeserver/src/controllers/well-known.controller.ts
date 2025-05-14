import { Controller, Get, Inject, Injectable, Res } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '../services/config.service';
import { Logger } from '../utils/logger';

const logger = new Logger('WellKnownController');

@Controller('/')
@Injectable()
export class WellKnownController {
	constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

	@Get('/.well-known/matrix/server')
	async server(@Res() response: Response) {
        const responseData = {
            'm.server': `${this.configService.getServerConfig().name}:443`,
        };

        try {
            const etag = new Bun.CryptoHasher('md5')
                .update(JSON.stringify(responseData))
                .digest('hex');

            response.setHeader('ETag', etag);
            response.setHeader('Content-Type', 'application/json');
            
            response.status(200).json(responseData);
        } catch (error) {
            logger.error(error);
            response.status(500).json({ error: 'Internal server error' });
        }
	}
}
