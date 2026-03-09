import type { RoomID } from '@rocket.chat/federation-room';
import 'reflect-metadata';
import { delay, inject, singleton } from 'tsyringe';

import { LockRepository } from '../repositories/lock.repository';
import { ConfigService } from '../services/config.service';

type QueueHandler = (roomId: RoomID) => AsyncGenerator<unknown | undefined>;

@singleton()
export class StagingAreaQueue {
	private queue: RoomID[] = [];

	private handler: QueueHandler | null = null;

	private processing = false;

	constructor(
		@inject(delay(() => LockRepository))
		private readonly lockRepository: LockRepository,
		private readonly configService: ConfigService,
	) {}

	enqueue(roomId: RoomID): void {
		this.queue.push(roomId);
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
			while (this.queue.length > 0) {
				const roomId = this.queue.shift() as RoomID;
				if (!roomId) continue;

					// eslint-disable-next-line no-await-in-loop, prettier/prettier
					await using lock = await this.lockRepository.lock(
						roomId,
						this.configService.instanceId,
					);

					if (!lock.success) {
						continue;
					}

				// eslint-disable-next-line no-await-in-loop --- this is valid since this.handler is an async generator
				for await (const _ of this.handler(roomId)) {
						await lock.update();
				}
			}
		} finally {
			this.processing = false;

			// Check if new items were added while processing
			if (this.queue.length > 0) {
				this.processQueue();
			}
		}
	}
}
