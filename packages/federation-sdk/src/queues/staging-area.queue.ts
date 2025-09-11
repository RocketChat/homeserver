import 'reflect-metadata';
import { singleton } from 'tsyringe';

type QueueHandler = (roomId: string) => Promise<void>;

@singleton()
export class StagingAreaQueue {
	private queue: string[] = [];
	private handlers: QueueHandler[] = [];
	private processing = false;

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
					await handler(roomId);
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
