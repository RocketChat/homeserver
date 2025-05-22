import { Controller, Get, Logger } from "@nestjs/common";

@Controller("/internal/ping")
export class PingController {
	private readonly logger = new Logger(PingController.name);

	@Get()
	ping() {
		this.logger.debug("Ping endpoint called");
		return "PONG!";
	}
}
