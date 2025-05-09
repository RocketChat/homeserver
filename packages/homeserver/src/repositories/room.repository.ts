import { Inject, Injectable } from '@nestjs/common';
import { Collection, ObjectId } from 'mongodb';
import { DatabaseConnection } from '../database/database.connection';
import { EventBase } from '../models/event.model';

type Room = {
  room_id: string;
  name: string;
  alias: string;
  canonical_alias: string;
  join_rules: string;
}

@Injectable()
export class RoomRepository {
  private collection: Collection<Room> | null = null;
  
  constructor(
    @Inject(DatabaseConnection) private readonly dbConnection: DatabaseConnection
  ) {}
  
  private async getCollection(): Promise<Collection<Room>> {
    if (!this.collection && !this.dbConnection) {
      throw new Error('Database connection was not injected properly');
    }
    
    const db = await this.dbConnection.getDb();
    this.collection = db.collection<Room>('rooms');
    return this.collection;
  }

  async upsert(roomId: string, state: EventBase[]) {
    const collection = await this.getCollection();
    await collection.findOneAndUpdate(
      { _id: new ObjectId(roomId) },
      {
        $set: {
          _id: roomId,
          state,
        },
      },
      { upsert: true },
    );
  }

  async getRoomVersion(roomId: string): Promise<string | null> {
    const collection = await this.getCollection();
    const room = await collection.findOne({ room_id: roomId }, { projection: { version: 1 } });
    return room?.version || null;
  }
}