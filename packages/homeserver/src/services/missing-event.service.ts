import { Injectable, Logger } from '@nestjs/common';
import type { MissingEventType } from '../queues/missing-event.queue';
import { MissingEventsQueue } from '../queues/missing-event.queue';

@Injectable()
export class MissingEventService {
	private readonly logger = new Logger(MissingEventService.name);

	constructor(private readonly missingEventsQueue: MissingEventsQueue) {}

	addEvent(event: MissingEventType) {
		this.logger.debug(
			`Adding missing event ${event.eventId} to missing events queue`,
		);
		this.missingEventsQueue.enqueue(event);
	}

	addEvents(events: MissingEventType[]) {
		for (const event of events) {
			this.addEvent(event);
		}
	}
}
