import { HomeserverModule } from '@hs/homeserver/src/homeserver.module';
import { HttpLoggerInterceptor } from '@hs/homeserver/src/middleware/http-logger.interceptor';
import { ConfigService } from '@hs/homeserver/src/services/config.service';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import * as fs from 'fs';

async function bootstrap() {
  try {
    const certPath = process.env.SERVER_TLS_CERT_FILE;
    const keyPath = process.env.SERVER_TLS_KEY_FILE;

	let tls: { cert: Buffer, key: Buffer } | undefined;
	if (certPath && keyPath) {
		tls = { 
			cert: fs.readFileSync(certPath),
			key: fs.readFileSync(keyPath)
		};
	}

    const nestApp = await NestFactory.create(HomeserverModule, {
      logger: ['error', 'warn', 'log', 'debug'],
      ...(tls && { httpsOptions: tls }),
    });
    
    nestApp.useGlobalInterceptors(new HttpLoggerInterceptor());
    
    await nestApp.init();

    const configService = nestApp.get(ConfigService);
    
    const port = configService.getServerConfig().port;
    const host = configService.getServerConfig().host;
    
    nestApp.listen(port, () => {
      console.log(`🚀 App running on ${tls ? 'https' : 'http'}://${host}:${port}`);
    });
  } catch (error) {
    console.error('Error setting up the application:', error);
    process.exit(1);
  }
}

bootstrap();
