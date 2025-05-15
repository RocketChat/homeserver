import { Controller, Put } from '@nestjs/common';
import { ConfigService } from '../services/config.service';
import { Logger } from '../utils/logger';

const logger = new Logger('VersionsController');

@Controller('/_matrix/federation/v1')
export class VersionsController {
	constructor(private readonly configService: ConfigService) {}

	@Put('/version')
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
