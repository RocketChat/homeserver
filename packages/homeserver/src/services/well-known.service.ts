import { Injectable } from '@nestjs/common';
import { ConfigService } from './config.service';

@Injectable()
export class WellKnownService {
	constructor(private readonly configService: ConfigService) {}

	getWellKnownHostData() {
		return {
			'm.server': `${this.configService.getServerConfig().name}:443`,
		};
	}
}
