import { StagingEvent } from '../../events/stagingArea';
import { Logger } from '../../utils/logger';
import { Pipeline } from '../decorators/pipeline.decorator';
import {
  EventAuthChainValidator,
  EventFormatValidator,
  EventHashesAndSignaturesValidator
} from '../validators';
import { SequentialPipeline, type IPipeline } from './index';

const logger = new Logger("EventValidationPipeline");

@Pipeline()
export class EventValidationPipeline implements IPipeline<StagingEvent[]> {
  private pipeline: IPipeline<StagingEvent[]>;

  constructor() {
    this.pipeline = this.createPipeline();
  }

  private createPipeline(): IPipeline<StagingEvent[]> {
    return new SequentialPipeline<StagingEvent[]>()
      .add(new EventFormatValidator())
      .add(new EventHashesAndSignaturesValidator())
      .add(new EventAuthChainValidator())
  }
  
  async validate(events: StagingEvent[], context: any) {
    return await this.pipeline.validate(events, context);
  }

  async saveValidatedEvents(events: StagingEvent[], context: any) {
    if (!context.mongo?.createEvent) {
      logger.warn('No createEvent function provided');
      return;
    }

    for (const event of events) {
      try {
        await context.mongo.createEvent(event.event);
      } catch (error) {
        logger.error(`Failed to save validated event: ${error}`);
      }
    }
  }
}