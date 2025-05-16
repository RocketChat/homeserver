import { failure, success, type ValidationResult } from '../ValidationResult';
import type { AuthorizedEvent } from '../validators/EventValidators';
import { registerEventHandler } from './index';

export async function validateRoomMessage(
  event: AuthorizedEvent,
  eventId: string
): Promise<ValidationResult> {
  try {
    // Messages must have auth events
    if (!event.authorizedEvent.auth_event_objects || 
        event.authorizedEvent.auth_event_objects.length === 0) {
      console.error(`Message ${eventId} is missing required auth events`);
      return failure('M_MISSING_AUTH_EVENTS', 'Messages must have auth events');
    }

    // Check for required auth events in auth_event_objects
    const { auth_event_objects } = event.authorizedEvent;
    let createEvent = null;
    let powerLevels = null;
    let senderMembership = null;

    // Find the required auth events
    for (const authObj of auth_event_objects) {
      if (!authObj.event) continue;
      
      if (authObj.event.type === 'm.room.create' && authObj.event.state_key === '') {
        createEvent = authObj.event;
      } 
      else if (authObj.event.type === 'm.room.power_levels' && authObj.event.state_key === '') {
        powerLevels = authObj.event;
      }
      else if (authObj.event.type === 'm.room.member' && authObj.event.state_key === event.event.sender) {
        senderMembership = authObj.event;
      }
    }

    // 1. Check for create event
    if (!createEvent) {
      console.error(`Message ${eventId} missing required m.room.create event`);
      return failure('M_MISSING_AUTH_EVENTS', 'Message must reference the room create event');
    }

    // 2. Check for power levels
    if (!powerLevels) {
      console.error(`Message ${eventId} missing required m.room.power_levels event`);
      return failure('M_MISSING_AUTH_EVENTS', 'Message must reference the room power levels');
    }

    // 3. Check for sender's membership
    if (!senderMembership) {
      console.error(`Message ${eventId} missing sender's membership event`);
      return failure('M_MISSING_AUTH_EVENTS', 'Message must reference the sender\'s membership');
    }

    // Check that sender is actually in the room
    if (senderMembership.content?.membership !== 'join') {
      console.error(`Message ${eventId} sender is not joined to the room`);
      return failure('M_FORBIDDEN', 'Sender must be joined to the room to send messages');
    }

    // 4. Check that user has permission to send messages based on power levels
    const eventPowerLevel = (powerLevels.content?.events?.['m.room.message'] ?? 
                             powerLevels.content?.events_default ?? 
                             0);
    
    const userPowerLevel = (powerLevels.content?.users?.[event.event.sender] ?? 
                            powerLevels.content?.users_default ?? 
                            0);

    if (userPowerLevel < eventPowerLevel) {
      console.error(`Message ${eventId} sender has insufficient power level: ${userPowerLevel} < ${eventPowerLevel}`);
      return failure('M_FORBIDDEN', 'Sender does not have sufficient power level to send messages');
    }

    // Validate basic message structure
    if (!event.event.content) {
      console.error(`Message ${eventId} missing content`);
      return failure('M_MISSING_PARAM', 'Message must have content');
    }

    // Validate msgtype if present
    const msgtype = event.event.content.msgtype;
    if (msgtype) {
      const validTypes = ['m.text', 'm.emote', 'm.notice', 'm.image', 'm.file', 'm.audio', 'm.video', 'm.location'];
      if (!validTypes.includes(msgtype) && !msgtype.startsWith('m.')) {
        console.warn(`Message ${eventId} has non-standard msgtype: ${msgtype}`);
        // We don't fail on this, just warn
      }
    }

    console.debug(`Message ${eventId} passed validation`);
    return success(event);
    
  } catch (error: any) {
    console.error(`Error validating message ${eventId}: ${error.message || String(error)}`);
    return failure('M_UNKNOWN', `Error validating message: ${error.message || String(error)}`);
  }
}

export function registerMessageValidator(): void {
  registerEventHandler('m.room.message', validateRoomMessage);
} 