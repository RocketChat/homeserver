import { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type Lock = {
	roomId: string;
	instanceId: string;
};

@singleton()
export class LockRepository {
	constructor(
		@inject('LockCollection') private readonly collection: Collection<Lock>,
	) {}

	async getLock(roomId: string, instanceId: string): Promise<Lock | null> {
		return this.collection.findOneAndUpdate(
			{ roomId },
			{
				$set: {
					instanceId,
				},
			},
			{ upsert: true, returnDocument: 'after' },
		);
	}

	async releaseLock(roomId: string, instanceId: string): Promise<void> {
		await this.collection.deleteOne({ roomId, instanceId });
	}
}
