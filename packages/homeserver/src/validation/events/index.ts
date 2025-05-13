import { Logger } from '../../utils/logger';
import { AuthorizedEvent, ValidationResult, success } from '../validators/index';

const logger = new Logger('EventDispatcher');

const eventValidators: Record<string, (event: AuthorizedEvent, eventId: string) => Promise<ValidationResult>> = {};

export function registerEventHandler(
  eventType: string,
  handler: (event: AuthorizedEvent, eventId: string) => Promise<ValidationResult>
): void {
  eventValidators[eventType] = handler;
  logger.info(`Registered validator for ${eventType}`);
}

export async function validateEventByType(
  event: AuthorizedEvent,
  eventId: string
): Promise<ValidationResult> {
  const eventType = event.event.type;
  
  if (!eventValidators[eventType]) {
    logger.debug(`No specific validator registered for event type ${eventType}, using default validation`);
    return success(event);
  }
  
  logger.debug(`Dispatching ${eventType} event ${eventId} to specific validator`);
  return eventValidators[eventType](event, eventId);
}

export const eventTypeValidator = validateEventByType;
