import { Logger } from '../../utils/logger';
import { Validator } from '../decorators/validator.decorator';
import { IPipeline, ValidatorResponse } from '../pipelines';

const logger = new Logger("OutlierDetectionValidator");

@Validator()
export class OutlierDetectionValidator implements IPipeline {
  async validate(events: any[], context: any): Promise<ValidatorResponse> {
    const pdus: Array<Record<string, any>> = [];
    const edus: Array<Record<string, any>> = [];

    for (const event of events) {
      try {
        const eventId = event?.event_id || `${event.type}_${event.room_id}_${Date.now()}`;
        logger.debug(`Checking for outlier status for event ${eventId}`);
        
        if (event.type === 'm.room.create' && event.state_key === '') {
          logger.debug(`Event ${eventId} is a create event, not an outlier`);
          pdus.push({ [eventId]: {} });
          continue;
        }
        
        const isReferenced = await this.isEventReferenced(event, context);
        const hasKnownParents = await this.hasKnownParents(event, context);
        const isOutlier = !isReferenced || !hasKnownParents;
        
        if (isOutlier) {
          logger.info(`Event ${eventId} identified as an outlier (referenced=${isReferenced}, known_parents=${hasKnownParents})`);
          
          // Mark event as an outlier but don't reject it
          // This is important information for further processing
          pdus.push({ 
            [eventId]: {
              is_outlier: true
            } 
          });
        } else {
          logger.debug(`Event ${eventId} is part of the main event graph`);
          pdus.push({ [eventId]: {} });
        }
      } catch (error: any) {
        const eventId = event?.event_id || 'unknown';
        logger.error(`Error during outlier detection for ${eventId}: ${error.message || String(error)}`);
        pdus.push({
          [eventId]: {
            errcode: 'M_OUTLIER_DETECTION_ERROR',
            error: `Error during outlier detection: ${error.message || String(error)}`
          }
        });
      }
    }

    return { pdus, edus };
  }
  
  private async isEventReferenced(event: any, context: any): Promise<boolean> {
    if (!event.event_id || !context.mongo?.isEventReferenced) {
      return false;
    }
    
    try {
      return await context.mongo.isEventReferenced(event.event_id, event.room_id);
    } catch (error) {
      logger.warn(`Error checking if event is referenced: ${error}`);
      return false;
    }
  }
  
  private async hasKnownParents(event: any, context: any): Promise<boolean> {
    if (!event.prev_events || !event.prev_events.length || !context.mongo?.areEventsInMainDAG) {
      return false;
    }
    
    try {
      const prevEventIds = event.prev_events.map((pe: any) => 
        Array.isArray(pe) ? pe[0] : pe
      );
      
      return await context.mongo.areEventsInMainDAG(prevEventIds, event.room_id);
    } catch (error) {
      logger.warn(`Error checking if event has known parents: ${error}`);
      return false;
    }
  }
} 