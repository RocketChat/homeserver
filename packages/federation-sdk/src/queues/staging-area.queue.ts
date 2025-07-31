import 'reflect-metadata';
import type { EventBaseWithOptionalId } from '@hs/core';
import { singleton } from 'tsyringe';

export interface StagingAreaEventType {
	eventId: string;
	roomId: string;
	origin: string;
	event: EventBaseWithOptionalId;
	metadata?: Record<string, unknown>;
}

type QueueHandler = (item: StagingAreaEventType) => Promise<void>;

@singleton()
export class StagingAreaQueue {
	private queue: StagingAreaEventType[] = [];
	private priorityQueue: StagingAreaEventType[] = [];
	private handlers: QueueHandler[] = [];
	private processing = false;

	enqueue(item: StagingAreaEventType): void {
		// If this is a continuation of processing (has metadata.state), add to priority queue
		if (
			item.metadata?.state &&
			item.metadata.state !== 'pending_dependencies'
		) {
			this.priorityQueue.push(item);
		} else {
			this.queue.push(item);
		}
		this.processQueue();
	}

	dequeue(): StagingAreaEventType | undefined {
		return this.queue.shift();
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
			while (this.priorityQueue.length > 0 || this.queue.length > 0) {
				// Process priority queue first (events in mid-processing)
				const item = this.priorityQueue.shift() || this.queue.shift();
				if (!item) continue;

				for (const handler of this.handlers) {
					await handler(item);
				}
			}
		} finally {
			this.processing = false;

			// Check if new items were added while processing
			if (this.priorityQueue.length > 0 || this.queue.length > 0) {
				this.processQueue();
			}
		}
	}
}
