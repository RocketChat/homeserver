import { Inject, Injectable } from '@nestjs/common';
import { MissingEventsQueue, MissingEventType } from '../queues/missing-event.queue';

@Injectable()
export class MissingEventService {
  constructor(
    @Inject(MissingEventsQueue) private readonly missingEventsQueue: MissingEventsQueue
  ) {}

  addEvent(event: MissingEventType) {
    this.missingEventsQueue.enqueue(event);
  }

  addEvents(events: MissingEventType[]) {
    for (const event of events) {
      this.addEvent(event);
    }
  }
} 
