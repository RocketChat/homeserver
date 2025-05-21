import { Inject, Injectable } from "@nestjs/common";
import type { Collection, FindCursor, WithId } from "mongodb";
import { DatabaseConnection } from "../database/database.connection";

import type { ServerKey } from "@hs/typings/src";

@Injectable()
export class KeyRepository {
  private collection: Collection<ServerKey> | null = null;

  constructor(
    @Inject(DatabaseConnection)
    private readonly dbConnection: DatabaseConnection
  ) {}

  private async getCollection(): Promise<Collection<ServerKey>> {
    if (!this.collection && !this.dbConnection) {
      throw new Error("Database connection was not injected properly");
    }

    const db = await this.dbConnection.getDb();
    this.collection = db.collection<ServerKey>("keys");
    return this.collection;
  }

  // storeKey either inserts a key
  async storeKey(
    serverName: string,
    keyId: string,
    encodedBase64String: string,
    expiresAt: number
  ) {
    const collection = await this.getCollection();

    return collection.findOneAndUpdate(
      { serverName },
      {
        $set: {
          serverName, // passing here to make sure upsert works
          [`keys.${keyId}`]: {
            key: encodedBase64String,
            _createdAt: new Date(),
            expiresAt,
          },
        },
      },
      {
        upsert: true,
        returnDocument: "after",
      }
    );
  }

  // there should be only one key for a server with the same id
  // spec does not dictate whether we should expect more than one
  async findKey(
    serverName: string,
    keyId: string,
    validUntil?: number
  ): Promise<WithId<ServerKey> | null> {
    const collection = await this.getCollection();

    return collection.findOne({
      serverName,
      [`keys.${keyId}`]: { $exists: true },
      ...(validUntil && { [`keys.${keyId}.validUntil`]: { $lte: validUntil } }),
    });
  }

  async findAllKeyForServerName(serverName: string) {
    const collection = await this.getCollection();

    return collection.findOne({
      serverName,
    });
  }
}
