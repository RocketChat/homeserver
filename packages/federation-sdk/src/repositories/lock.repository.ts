import { createLogger } from '@rocket.chat/federation-core';
import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export const LOCK_TIMEOUT_MS = 2 * 60 * 1000;

// a few refreshes per timeout, so one slow refresh doesn't let the lock go stale
export const LOCK_KEEP_ALIVE_INTERVAL_MS = LOCK_TIMEOUT_MS / 4;

export type Lock = {
	roomId: string;
	instanceId: string;
	lockedAt: Date;
};

@singleton()
export class LockRepository {
	private readonly logger = createLogger('LockRepository');

	constructor(@inject('LockCollection') private readonly collection: Collection<Lock>) {
		// TODO define proper way of creating indexes in repositories
		this.collection.createIndex({ roomId: 1 }, { unique: true });
	}

	/** keepAlive refreshes the lock until it is disposed, for holders that can't call update() often enough */
	async lock(
		roomId: string,
		instanceId: string,
		{ keepAlive = false }: { keepAlive?: boolean } = {},
	): Promise<{
		success: boolean;
		update: () => Promise<void>;
		[Symbol.asyncDispose]: () => Promise<void>;
	}> {
		const lock = await this.getLock(roomId, instanceId);

		const keepAliveTimer =
			lock && keepAlive
				? setInterval(() => {
						this.updateLockTimestamp(roomId, instanceId).catch((err) => this.logger.warn({ msg: 'Failed to refresh lock', roomId, err }));
				  }, LOCK_KEEP_ALIVE_INTERVAL_MS)
				: undefined;

		return {
			success: lock,
			update: async () => {
				if (!lock) {
					return;
				}
				return this.updateLockTimestamp(roomId, instanceId);
			},
			[Symbol.asyncDispose]: async () => {
				clearInterval(keepAliveTimer);
				if (!lock) {
					return;
				}
				return this.releaseLock(roomId, instanceId);
			},
		};
	}

	async getLock(roomId: string, instanceId: string): Promise<boolean> {
		const timedout = new Date(Date.now() - LOCK_TIMEOUT_MS);

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
		await this.collection.deleteOne({ roomId, instanceId });
	}

	async updateLockTimestamp(roomId: string, instanceId: string): Promise<void> {
		await this.collection.updateOne({ roomId, instanceId }, { $set: { lockedAt: new Date() } });
	}
}
