import { injectable } from 'tsyringe';
import { ConfigService } from './config.service';

@injectable()
export class WellKnownService {
	constructor(private readonly configService: ConfigService) {}

	getWellKnownHostData() {
		return {
			'm.server': `${this.configService.getServerConfig().name}:443`,
		};
	}
}
