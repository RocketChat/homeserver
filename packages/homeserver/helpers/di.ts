import { Provider, Type } from '@nestjs/common';
import { ConfigService } from '../src/services/config.service';

export function createControllerProvider<T>(
  controller: Type<T>,
  factory: (configService: ConfigService) => T
): Provider {
  return {
    provide: controller,
    useFactory: (configService: ConfigService) => {
      return factory(configService);
    },
    inject: [ConfigService],
  };
}

export function createControllerProviders(controllers: any[]): Provider[] {
  return controllers.map(controller => ({
    provide: controller,
    useFactory: (configService: ConfigService) => {
      return new controller(configService);
    },
    inject: [ConfigService],
  }));
} 