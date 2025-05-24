import { Injectable } from "@nestjs/common";
import type { Collection, FindCursor } from "mongodb";
import type { EventBase } from "../models/event.model";
import { DatabaseConnectionService } from "../services/database-connection.service";

@Injectable()
export class StateEventRepository {
	private collection: Collection<EventBase> | null = null;

	constructor(private readonly dbConnection: DatabaseConnectionService) {
		this.getCollection();
	}

	private async getCollection(): Promise<Collection<EventBase>> {
		const db = await this.dbConnection.getDb();
		this.collection = db.collection<EventBase>("final_state_events");
		return this.collection;
	}

	async findByRoomId(roomId: string): Promise<FindCursor<EventBase>> {
		const collection = await this.getCollection();
		return collection.find({ roomId });
	}
}