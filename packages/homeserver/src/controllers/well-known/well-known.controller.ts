import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WellKnownService } from '../../services/well-known.service';

@Controller('/.well-known/matrix/server')
export class WellKnownController {
	constructor(private readonly wellKnownService: WellKnownService) {}

	@Get()
	getWellKnown(@Res({ passthrough: true }) res: Response) {
                const responseData = this.wellKnownService.getWellKnownHostData();

                const etag = new Bun.CryptoHasher('md5')
                        .update(JSON.stringify(responseData))
                        .digest('hex');

                res.setHeader('ETag', etag);
                res.setHeader('Content-Type', 'application/json');
                
                return responseData;
	}
}
