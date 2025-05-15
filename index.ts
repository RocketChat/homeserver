import "reflect-metadata";

import { GlobalExceptionFilter } from "@hs/homeserver/src/filters/http-exception.filter";
import { HomeserverModule } from "@hs/homeserver/src/homeserver.module";
import { ResponseInterceptor } from "@hs/homeserver/src/interceptors/response.interceptor";
import { NestFactory } from "@nestjs/core";

async function bootstrap() {
	try {
		const nestApp = await NestFactory.create(HomeserverModule);

		nestApp.useGlobalInterceptors(new ResponseInterceptor());
		nestApp.useGlobalFilters(new GlobalExceptionFilter());

		nestApp.listen(8080, () =>
			console.log("🚀 App running on http://localhost:8080"),
		);
	} catch (error) {
		console.error("Error setting up the application:", error);
	}
}

bootstrap();
