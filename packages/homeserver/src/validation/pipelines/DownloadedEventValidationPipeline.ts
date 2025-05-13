import { generateId } from '../../authentication';
import { Logger } from '../../utils/logger';
import { Pipeline } from '../decorators/pipeline.decorator';
import { EventFormatValidator } from '../validators/EventFormatValidator';
import { EventHashesAndSignaturesValidator } from '../validators/EventHashesAndSignaturesValidator';
import { IPipeline, SequentialPipeline, ValidatorResponse } from './index';

const logger = new Logger("DownloadedEventValidationPipeline");

@Pipeline()
export class DownloadedEventValidationPipeline implements IPipeline {
  private pipeline: IPipeline;

  constructor() {
    this.pipeline = this.createPipeline();
  }

  private createPipeline(): IPipeline {
    return new SequentialPipeline()
      .add(new EventFormatValidator()) 
      .add(new EventHashesAndSignaturesValidator());
  }

  async validate(events: any[], context: any): Promise<ValidatorResponse> {
    try {
      if (!events || events.length === 0) {
        return { pdus: [], edus: [] };
      }

      logger.debug(`Validating ${events.length} downloaded events`);
      return await this.pipeline.validate(events, context);
    } catch (error: any) {
      logger.error(`Error validating downloaded events: ${error.message || String(error)}`);
      const pdus = events.map(event => {
        const eventId = event.event_id || generateId(event);
        return { 
          [eventId]: { 
            errcode: 'M_VALIDATION_ERROR', 
            error: `Failed to validate downloaded event: ${error.message || 'Unknown error'}` 
          } 
        };
      });

      return { pdus, edus: [] };
    }
  }
} 