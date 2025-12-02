import { RoomID } from '@rocket.chat/federation-room';
import 'reflect-metadata';
import { singleton } from 'tsyringe';

type QueueHandler = (roomId: RoomID) => Promise<void>;

@singleton()
export class StagingAreaQueue {
	private queue: RoomID[] = [];
	private handlers: QueueHandler[] = [];
	private processing = false;

	enqueue(roomId: RoomID): void {
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
				const roomId = this.queue.shift() as RoomID;
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
