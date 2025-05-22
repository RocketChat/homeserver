import "reflect-metadata";

import { HomeserverModule } from "@hs/homeserver/src/homeserver.module";
import { NestFactory } from "@nestjs/core";

async function bootstrap() {
	const nestApp = await NestFactory.create(HomeserverModule, {
		logger: ['error', 'warn', 'log', 'debug'],
	});

	nestApp.listen(8080, () => console.log("🚀 App running on http://localhost:8080"));
}

bootstrap();
