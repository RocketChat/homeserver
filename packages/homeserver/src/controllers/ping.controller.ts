import { Controller, Get } from "@nestjs/common";
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
