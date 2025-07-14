import { singleton } from 'tsyringe';
import { ConfigService } from './config.service';

@singleton()
export class WellKnownService {
	constructor(private readonly configService: ConfigService) {}

	getWellKnownHostData() {
		return {
			'm.server': `${this.configService.getServerConfig().name}:443`,
		};
	}
}
