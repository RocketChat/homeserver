import { Logger } from '../../../routes/federation/logger';
import { ValidationResult, success } from '../../../validation/Validator';
import { AuthorizedEvent } from '../index';

import { registerCreateValidator } from './m.room.create';
import { registerMemberValidator } from './m.room.member';
import { registerMessageValidator } from './m.room.message';
import { registerPowerLevelsValidator } from './m.room.power_levels';
import { registerJoinRulesValidator } from './m.room.join_rules';

const logger = new Logger('EventDispatcher');

const eventValidators: Record<string, (event: AuthorizedEvent, eventId: string) => Promise<ValidationResult>> = {};

export function registerEventHandler(
  eventType: string,
  handler: (event: AuthorizedEvent, eventId: string) => Promise<ValidationResult>
): void {
  eventValidators[eventType] = handler;
  logger.info(`Registered validator for ${eventType}`);
}

export function registerAllEventValidators(): void {
  logger.info('Registering all standard event validators');
  registerCreateValidator();
  registerMemberValidator();
  registerMessageValidator();
  registerPowerLevelsValidator();
  registerJoinRulesValidator();
  logger.info(`Successfully registered ${Object.keys(eventValidators).length} event validators`);
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
