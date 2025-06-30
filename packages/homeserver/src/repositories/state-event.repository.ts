import { injectable } from 'tsyringe';
import type { Collection, FindCursor } from 'mongodb';
import type { EventBase } from '../models/event.model';
import { DatabaseConnectionService } from '@hs/federation-sdk/src/services/database-connection.service';

@injectable()
export class StateEventRepository {
	private collection: Collection<EventBase> | null = null;

	constructor(private readonly dbConnection: DatabaseConnectionService) {
		this.getCollection();
	}

	private async getCollection(): Promise<Collection<EventBase>> {
		const db = await this.dbConnection.getDb();
		this.collection = db.collection<EventBase>('final_state_events');
		return this.collection;
	}

	async findByRoomId(roomId: string): Promise<FindCursor<EventBase>> {
		const collection = await this.getCollection();
		return collection.find({ roomId });
	}

	async updateState(roomId: string, state: EventBase[]): Promise<void> {
		const collection = await this.getCollection();
		await Promise.all(
			state.map((event) => {
				return collection.updateOne(
					{ room_id: roomId, type: event.type, state_key: event.state_key },
					{ $set: event },
				);
			}),
		);
	}
}
