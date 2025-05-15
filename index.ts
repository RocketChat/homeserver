import "reflect-metadata";

import { GlobalExceptionFilter } from "@hs/homeserver/src/filters/http-exception.filter";
import { HomeserverModule } from "@hs/homeserver/src/homeserver.module";
import { ResponseInterceptor } from "@hs/homeserver/src/interceptors/response.interceptor";
import { LogLevel, LoggerService } from "@hs/homeserver/src/services/logger.service";
import { NestFactory } from "@nestjs/core";

async function bootstrap() {
	try {
		// Set global log level based on environment
		const nodeEnv = process.env.NODE_ENV || 'development';
		LoggerService.setLogLevel(
			nodeEnv === 'production' ? LogLevel.WARN : LogLevel.DEBUG
		);

		const nestApp = await NestFactory.create(HomeserverModule);

		nestApp.useGlobalInterceptors(new ResponseInterceptor());
		nestApp.useGlobalFilters(new GlobalExceptionFilter());

		// nestApp.useGlobalInterceptors(new HttpLoggerInterceptor());
		// const configService = nestApp.get(ConfigService);
		// const port = configService.getServerConfig().port;
		// const host = configService.getServerConfig().host;

		nestApp.listen(8080, () =>
			console.log("🚀 App running on http://localhost:8080"),
		);
	} catch (error) {
		console.error("Error setting up the application:", error);
	}
}

bootstrap();
