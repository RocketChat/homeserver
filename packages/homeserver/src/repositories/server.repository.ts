import { Inject, Injectable } from '@nestjs/common';
import { Collection } from 'mongodb';
import { DatabaseConnection } from '../database/database.connection';

type Server = {
  name: string;
  keys: {
    [key: string]: {
      key: string;
      validUntil: number;
    };
  };
}

@Injectable()
export class ServerRepository {
  private collection: Collection<Server> | null = null;
  
  constructor(
    @Inject(DatabaseConnection) private readonly dbConnection: DatabaseConnection
  ) {}
  
  private async getCollection(): Promise<Collection<Server>> {
    if (!this.collection && !this.dbConnection) {
      throw new Error('Database connection was not injected properly');
    }
    
    const db = await this.dbConnection.getDb();
    this.collection = db.collection<Server>('servers');
    return this.collection;
  }

  async getValidPublicKeyFromLocal(origin: string, key: string): Promise<string | undefined> {
    const collection = await this.getCollection();
    const server = await collection.findOne({ name: origin });
    return server?.keys?.[key];
  }

  async storePublicKey(origin: string, key: string, value: string, validUntil: number): Promise<void> {
    const collection = await this.getCollection();
    await collection.findOneAndUpdate(
      { name: origin },
      {
        $set: {
          [`keys.${key}`]: {
            key: value,
            validUntil,
          },
        },
      },
      { upsert: true },
    );
  }
}