import { Logger } from "../utils/logger";
import type { BaseEventType } from "../validation/schemas/event-schemas";

export type StagingEvent = {
  eventId: BaseEventType["event_id"];
  event: BaseEventType;
};

const logger = new Logger("StagingArea");

const getFirst = <T>(set: Set<T>): T | undefined => Array.from(set)[0];

export class StagingArea {
  private missingEventsQueue = new Set<string>();
  private processingQueue = new Set<StagingEvent>();
  private context: any;

  constructor() {
    this.startBackgroundProcessors();
  }

  private startBackgroundProcessors() {
    setImmediate(() => this.startMissingEventProcessor());
    setImmediate(() => this.startEventProcessor());
  }

  private async startMissingEventProcessor() {
    while (this.missingEventsQueue.size) {
      const eventId = this.missingEventsQueue.values().next().value;
      if (!eventId) {
        break;
      }

      this.missingEventsQueue.delete(eventId);
      
      const event = await this.getEventFromDatabase(eventId);
      if (event) {
        await this.processNewEvent({ eventId, event: event.event });
      }
    }
  }

  private async startEventProcessor() {
  }

  private addToProcessingQueue(stagingEvent: StagingEvent) {
    const exists = Array.from(this.processingQueue).some(item => item.eventId === stagingEvent.eventId);
    if (!exists) this.processingQueue.add(stagingEvent);
  }

  private async checkForMissingDependencies(event: any): Promise<string[]> {
    const authEvents = event?.auth_events ?? [];
    const prevEvents = event?.prev_events ?? [];
    const deps = [...authEvents, ...prevEvents];

    const missingDeps: string[] = [];
    for (const depId of deps) {
      if (typeof depId === "string" && !(await this.getEventFromDatabase(depId))) {
        missingDeps.push(depId);
      }
    }
    return missingDeps;
  }

  private async getEventFromDatabase(eventId: string): Promise<StagingEvent | null> {
    if (this.context.mongo.getEventById) {
      const event = await this.context.mongo.getEventById(eventId);
      return event ? { eventId: event._id, event: event.event } : null;
    }

    return null;
  }

  private async processNewEvent(stagingEvent: StagingEvent) {
    const { eventId, event } = stagingEvent;

    const missingDeps = await this.checkForMissingDependencies(event);

    if (missingDeps.length === 0) {
      logger.debug(`Event ${eventId} has all dependencies, adding to processing queue`);
      return this.addToProcessingQueue(stagingEvent);
    }

    logger.debug(`Event ${eventId} has ${missingDeps.length} missing dependencies`);
    missingDeps.forEach(depId => this.missingEventsQueue.add(depId));
  }

  public async addEvents(events: StagingEvent[], context: any) {
    this.context = context;
    logger.debug(`Adding ${events.length} events to staging area`);
    for (const event of events) {
      await this.processNewEvent(event);
    }
  }
}

export const stagingArea = new StagingArea();
