import { createLogger } from '@hs/core';
import { injectable } from 'tsyringe';
import type { MissingEventType } from '../queues/missing-event.queue';
import { MissingEventsQueue } from '../queues/missing-event.queue';

const logger = createLogger('MissingEventService');

@injectable()
export class MissingEventService {
	constructor(private readonly missingEventsQueue: MissingEventsQueue) {}

	addEvent(event: MissingEventType) {
		logger.debug(
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
