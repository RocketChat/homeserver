import { Injectable } from '@nestjs/common';
import { Collection, ObjectId } from 'mongodb';
import type { EventBase } from '../models/event.model';
import { DatabaseConnectionService } from '../services/database-connection.service';

type Room = {
  room_id: string;
  name: string;
  alias: string;
  canonical_alias: string;
  join_rules: string;
  version: string;
}

@Injectable()
export class RoomRepository {
	private collection: Collection<Room> | null = null;

	constructor(private readonly dbConnection: DatabaseConnectionService) {
		this.getCollection();
	}

	private async getCollection(): Promise<Collection<Room>> {
		const db = await this.dbConnection.getDb();
		this.collection = db.collection<Room>("rooms");
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

  async updateRoomName(roomId: string, name: string): Promise<void> {
    const collection = await this.getCollection();
    await collection.updateOne(
      { room_id: roomId },
      { $set: { name: name } },
      { upsert: false }
    );
  }
}