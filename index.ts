import { HomeserverModule } from '@hs/homeserver/src/homeserver.module';
import { HttpLoggerInterceptor } from '@hs/homeserver/src/middleware/http-logger.interceptor';
import { ConfigService } from '@hs/homeserver/src/services/config.service';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';

async function bootstrap() {
  try {
    const nestApp = await NestFactory.create(HomeserverModule, {
      logger: ['error', 'warn', 'log', 'debug'],
    });
    
    nestApp.useGlobalInterceptors(new HttpLoggerInterceptor());
    
    await nestApp.init();

    const configService = nestApp.get(ConfigService);
    
    const port = configService.getServerConfig().port;
    const host = configService.getServerConfig().host;
    
    nestApp.listen(port, () => {
      console.log(`🚀 App running on http://${host}:${port}`);
    });
  } catch (error) {
    console.error('Error setting up the application:', error);
  }
}

bootstrap();
