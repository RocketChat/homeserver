import type { MissingEventType } from '@hs/homeserver/src/queues/missing-event.queue';
import { MissingEventsQueue } from '@hs/homeserver/src/queues/missing-event.queue';
import { injectable } from 'tsyringe';
import { createLogger } from '@hs/core';

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
