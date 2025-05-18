import type { ValidationResult } from '../ValidationResult';
import { success } from '../ValidationResult';
import type { AuthorizedEvent } from '../validators/EventValidators';

const eventValidators: Record<string, (event: AuthorizedEvent, eventId: string) => Promise<ValidationResult>> = {};

export function registerEventHandler(
  eventType: string,
  handler: (event: AuthorizedEvent, eventId: string) => Promise<ValidationResult>
): void {
  eventValidators[eventType] = handler;
  console.info(`Registered validator for ${eventType}`);
}

export async function validateEventByType(
  event: AuthorizedEvent,
  eventId: string
): Promise<ValidationResult> {
  const eventType = event.event.type;
  
  if (!eventValidators[eventType]) {
    console.debug(`No specific validator registered for event type ${eventType}, using default validation`);
    return success(event);
  }
  
  console.debug(`Dispatching ${eventType} event ${eventId} to specific validator`);
  return eventValidators[eventType](event, eventId);
}

export const eventTypeValidator = validateEventByType;
