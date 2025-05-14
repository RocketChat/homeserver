import { Inject, Injectable } from '@nestjs/common';
import { EventBase } from '../models/event.model';
import { RoomRepository } from '../repositories/room.repository';

@Injectable()
export class RoomService {
  constructor(
    @Inject(RoomRepository) private readonly roomRepository: RoomRepository,
  ) {}

  async upsertRoom(roomId: string, state: EventBase[]) {
    await this.roomRepository.upsert(roomId, state);
  }
} 
