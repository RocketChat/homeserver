import { Injectable } from '@nestjs/common';
import { ServerRepository } from '../repositories/server.repository';
import { LoggerService } from './logger.service';

@Injectable()
export class ServerService {
  private readonly logger: LoggerService;

  constructor(
    private readonly serverRepository: ServerRepository,
    private readonly loggerService: LoggerService
  ) {
    this.logger = this.loggerService.setContext('ServerService');
  }

  async getValidPublicKeyFromLocal(origin: string, key: string): Promise<string | undefined> {
    return await this.serverRepository.getValidPublicKeyFromLocal(origin, key);
  }

  async storePublicKey(origin: string, key: string, value: string, validUntil: number): Promise<void> {
    await this.serverRepository.storePublicKey(origin, key, value, validUntil);
  }
} 
