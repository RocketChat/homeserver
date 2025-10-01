import 'reflect-metadata';
import { singleton } from 'tsyringe';
import { LockRepository } from '../repositories/lock.repository';
import { ConfigService } from '../services/config.service';

type QueueHandler = (roomId: string) => AsyncGenerator<unknown | undefined>;

@singleton()
export class StagingAreaQueue {
	private queue: string[] = [];
	private handlers: QueueHandler[] = [];
	private processing = false;

	constructor(
		private readonly lockRepository: LockRepository,
		private readonly configService: ConfigService,
	) {}

	enqueue(roomId: string): void {
		this.queue.push(roomId);
		this.processQueue();
	}

	registerHandler(handler: QueueHandler): void {
		this.handlers.push(handler);
	}

	private async processQueue(): Promise<void> {
		if (this.processing) {
			return;
		}

		this.processing = true;

		try {
			while (this.queue.length > 0) {
				const roomId = this.queue.shift();
				if (!roomId) continue;

				for (const handler of this.handlers) {
					await using lock = await this.lockRepository.lock(
						roomId,
						this.configService.instanceId,
					);
					if (!lock.success) {
						continue;
					}
					for await (const _ of handler(roomId)) {
						await lock.update();
					}
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
