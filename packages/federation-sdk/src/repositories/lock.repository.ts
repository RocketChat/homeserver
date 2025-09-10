import { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type Lock = {
	roomId: string;
	instanceId: string;
	lockedAt: Date;
};

@singleton()
export class LockRepository {
	constructor(
		@inject('LockCollection') private readonly collection: Collection<Lock>,
	) {
		// TODO define proper way of creating indexes in repositories
		this.collection.createIndex({ roomId: 1 }, { unique: true });
	}

	async getLock(roomId: string, instanceId: string): Promise<boolean> {
		const timedout = new Date();
		timedout.setTime(timedout.getTime() - 2 * 60 * 1000); // 2 minutes ago

		try {
			const lock = await this.collection.findOneAndUpdate(
				{ roomId, lockedAt: { $lt: timedout } },
				{
					$set: {
						instanceId,
						lockedAt: new Date(),
					},
				},
				{ upsert: true, returnDocument: 'before' },
			);

			// if no record was found, it means we successfully acquired the lock
			if (!lock) {
				return true;
			}

			// since we get the previous lock, check if it was timed out
			if (lock.lockedAt < timedout) {
				return true;
			}
		} catch (e) {
			// if we got a duplicate key error, it means lock is already held for room
			if ((e as { code?: number })?.code === 11000) {
				return false;
			}
			throw e;
		}

		return false;
	}

	async releaseLock(roomId: string, instanceId: string): Promise<void> {
		console.log(
			`Releasing lock for room ${roomId} held by instance ${instanceId}`,
		);
		await this.collection.deleteOne({ roomId, instanceId });
	}

	async updateLockTimestamp(roomId: string, instanceId: string): Promise<void> {
		await this.collection.updateOne(
			{ roomId, instanceId },
			{ $set: { lockedAt: new Date() } },
		);
	}
}
