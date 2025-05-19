import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '../../services/config.service';

@Controller('/_matrix/federation/v1')
export class VersionsController {
	constructor(private readonly configService: ConfigService) {}

	@Get('/version')
	async version() {
		const config = this.configService.getServerConfig();
		return {
			server: {
				name: config.name,
				version: config.version,
			},
		};
	}
}
