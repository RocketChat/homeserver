import type { RoomID } from '@rocket.chat/federation-room';
import 'reflect-metadata';
import { delay, inject, singleton } from 'tsyringe';

import { LockRepository } from '../repositories/lock.repository';
import { ConfigService } from '../services/config.service';

type QueueHandler = (roomId: RoomID) => AsyncGenerator<unknown | undefined>;

const QUEUE_MAX_TIME_PER_ROOM = parseInt(process.env.FEDERATION_QUEUE_MAX_TIME_PER_ROOM || '30', 10) * 1000;

const DEFAULT_QUEUE_CONCURRENCY = Math.max(
	1,
	parseInt(process.env.FEDERATION_QUEUE_CONCURRENCY || '10', 10) || 10,
);

@singleton()
export class StagingAreaQueue {
	private queue: Set<RoomID> = new Set();

	private handler: QueueHandler | null = null;

	private queueItems: Map<RoomID, Promise<void>> = new Map();

	private processing = false;

	constructor(
		@inject(delay(() => LockRepository))
		private readonly lockRepository: LockRepository,
		private readonly configService: ConfigService,
	) {}

	enqueue(roomId: RoomID): void {
		this.queue.add(roomId);
		this.processQueue();
	}

	registerHandler(handler: QueueHandler): void {
		this.handler = handler;
	}

	private async processQueue(): Promise<void> {
		if (this.processing) {
			return;
		}

		this.processing = true;
		while (this.queue.size > 0) {
			for (const roomId of this.queue) {
				while (this.queueItems.size < DEFAULT_QUEUE_CONCURRENCY) {
					this.queueItems.set(roomId, this.processQueueItem(roomId).catch(() => {
						this.queue.add(roomId);
					}).finally(() => {
						this.queueItems.delete(roomId);
					}));
				}
				while (this.queueItems.size > 0) {
					// eslint-disable-next-line no-await-in-loop
					await Promise.race(Array.from(this.queueItems.values())).catch((err) => {
						console.error({
							msg: 'Error processing item',
							err,
						});
					});
				}
			}
		}
		this.processing = false;
	}

	private async processQueueItem(roomId: RoomID): Promise<void> {

		if (!this.handler) {
			throw new Error('No handler registered for StagingAreaQueue');
		}


		// eslint-disable-next-line no-await-in-loop, prettier/prettier
		await using lock = await this.lockRepository.lock(
			roomId,
			this.configService.instanceId,
		);

		if (!lock.success) {
			return;
		}

		const startTime = Date.now();

		// eslint-disable-next-line no-await-in-loop --- this is valid since this.handler is an async generator
		for await (const _ of this.handler(roomId)) {
			// remove the item from the queue in case it was re-enqueued while processing
			this.queue.delete(roomId);

			const elapsed = Date.now() - startTime;
			if (elapsed > QUEUE_MAX_TIME_PER_ROOM) {
				throw new Error('Queue item took too long to process');
			}
			await lock.update();
		}
	}
}
