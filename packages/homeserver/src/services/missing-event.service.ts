import { Inject, Injectable } from '@nestjs/common';
import { MissingEventsQueue, MissingEventType } from '../queues/missing-event.queue';
import { Logger } from '../utils/logger';

@Injectable()
export class MissingEventService {
  private readonly logger = new Logger('MissingEventService');

  constructor(
    @Inject(MissingEventsQueue) private readonly missingEventsQueue: MissingEventsQueue
  ) {}

  addEvent(event: MissingEventType) {
    this.logger.debug(`Adding missing event ${event.eventId} to missing events queue`);
    this.missingEventsQueue.enqueue(event);
  }

  addEvents(events: MissingEventType[]) {
    for (const event of events) {
      this.addEvent(event);
    }
  }
} 
