import { Controller, Get, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '../services/config.service';

@Controller('/ping')
@Injectable()
export class PingController {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  @Get('/ping')
  ping() {
    return {
      status: 200,
      body: 'PONG!',
    };
  }
}