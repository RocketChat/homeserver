import { Injectable } from '@nestjs/common';
import { MissingEventsQueue, MissingEventType } from '../queues/missing-event.queue';
import { LoggerService } from './logger.service';

@Injectable()
export class MissingEventService {
  private readonly logger: LoggerService;

  constructor(
    private readonly missingEventsQueue: MissingEventsQueue,
    private readonly loggerService: LoggerService
  ) {
    this.logger = this.loggerService.setContext('MissingEventService');
  }

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
