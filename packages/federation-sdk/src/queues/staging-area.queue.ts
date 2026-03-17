import type { RoomID } from '@rocket.chat/federation-room';
import 'reflect-metadata';
import { delay, inject, singleton } from 'tsyringe';

import { LockRepository } from '../repositories/lock.repository';
import { ConfigService } from '../services/config.service';

type QueueHandler = (roomId: RoomID) => AsyncGenerator<unknown | undefined>;

const QUEUE_MAX_TIME_PER_ROOM = parseInt(process.env.FEDERATION_QUEUE_MAX_TIME_PER_ROOM || '30', 10) * 1000;

@singleton()
export class StagingAreaQueue {
	private queue: Set<RoomID> = new Set();

	private handler: QueueHandler | null = null;

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

		if (!this.handler) {
			throw new Error('No handler registered for StagingAreaQueue');
		}

		this.processing = true;

		try {
			while (this.queue.size > 0) {
				const [roomId] = this.queue;
				if (!roomId) continue;
				this.queue.delete(roomId);

				// eslint-disable-next-line no-await-in-loop, prettier/prettier
				await using lock = await this.lockRepository.lock(
					roomId,
					this.configService.instanceId,
				);

				if (!lock.success) {
					continue;
				}

				const startTime = Date.now();

				// eslint-disable-next-line no-await-in-loop --- this is valid since this.handler is an async generator
				for await (const _ of this.handler(roomId)) {
					// remove the item from the queue in case it was re-enqueued while processing
					this.queue.delete(roomId);

					const elapsed = Date.now() - startTime;
					if (elapsed > QUEUE_MAX_TIME_PER_ROOM) {
						this.queue.add(roomId);
						break;
					}
					await lock.update();
				}
			}
		} finally {
			this.processing = false;

			// Check if new items were added while processing
			if (this.queue.size > 0) {
				this.processQueue();
			}
		}
	}
}
