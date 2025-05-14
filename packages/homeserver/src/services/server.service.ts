import { Inject, Injectable } from '@nestjs/common';
import { ServerRepository } from '../repositories/server.repository';

@Injectable()
export class ServerService {
  constructor(
    @Inject(ServerRepository) private readonly serverRepository: ServerRepository,
  ) {}

  async getValidPublicKeyFromLocal(origin: string, key: string): Promise<string | undefined> {
    return await this.serverRepository.getValidPublicKeyFromLocal(origin, key);
  }

  async storePublicKey(origin: string, key: string, value: string, validUntil: number): Promise<void> {
    await this.serverRepository.storePublicKey(origin, key, value, validUntil);
  }
} 
