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

	async getLock(roomId: string, instanceId: string): Promise<boolean> {
		const lock = await this.collection.findOneAndUpdate(
			{ roomId },
			{
				$setOnInsert: {
					instanceId,
					lockedAt: new Date(),
				},
			},
			{ upsert: true, returnDocument: 'before' },
		);
		console.log('lock ->', lock);

		if (!lock) {
			return true;
		}

		return false;
	}

	async releaseLock(roomId: string, instanceId: string): Promise<void> {
		await this.collection.deleteOne({ roomId, instanceId });
	}
}
