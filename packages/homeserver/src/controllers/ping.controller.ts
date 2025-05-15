import { Controller, Get } from "@nestjs/common";
// biome-ignore lint/style/useImportType: Its a true logger and not just a type
import { LoggerService } from "../services/logger.service";

@Controller("/ping")
export class PingController {
	private readonly logger: LoggerService;

	constructor(loggerService: LoggerService) {
		this.logger = loggerService.setContext('PingController');
	}

	@Get()
	ping() {
		this.logger.debug("Ping endpoint called");
		return "PONG!";
	}
}
