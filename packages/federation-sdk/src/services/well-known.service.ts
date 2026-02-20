import { singleton } from 'tsyringe';

import type { ConfigService } from './config.service';

@singleton()
export class WellKnownService {
	constructor(private readonly configService: ConfigService) {}

	getWellKnownHostData() {
		return {
			'm.server': `${this.configService.serverName}:443`,
		};
	}
}
