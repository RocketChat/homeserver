import type { EventBaseWithOptionalId } from '@hs/core';
import type { Collection, FindCursor } from 'mongodb';
import { injectable } from 'tsyringe';
import { DatabaseConnectionService } from '../services/database-connection.service';

@injectable()
export class StateEventRepository {
	private collection: Collection<EventBaseWithOptionalId> | null = null;

	constructor(private readonly dbConnection: DatabaseConnectionService) {
		this.getCollection();
	}

	private async getCollection(): Promise<Collection<EventBaseWithOptionalId>> {
		const db = await this.dbConnection.getDb();
		this.collection =
			db.collection<EventBaseWithOptionalId>('final_state_events');
		return this.collection!;
	}

	async findByRoomId(
		roomId: string,
	): Promise<FindCursor<EventBaseWithOptionalId>> {
		const collection = await this.getCollection();
		return collection.find({ roomId });
	}

	async updateState(
		roomId: string,
		state: EventBaseWithOptionalId[],
	): Promise<void> {
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
