import { Logger } from '../../utils/logger';
import { AuthorizedEvent, ValidationResult, failure, success } from '../validators/index';
import { registerEventHandler } from './index';

const logger = new Logger("m.room.member");

enum Membership {
  JOIN = 'join',
  LEAVE = 'leave',
  INVITE = 'invite',
  BAN = 'ban',
  KNOCK = 'knock'
}

export async function validateMemberEvent(
  event: AuthorizedEvent,
  eventId: string
): Promise<ValidationResult> {
  try {
    const { event: rawEvent } = event;
    
    // Member events must have a state_key (the user ID being affected)
    if (rawEvent.state_key === undefined || rawEvent.state_key === '') {
      logger.error(`Member event ${eventId} has invalid state_key: '${rawEvent.state_key}'`);
      return failure('M_INVALID_PARAM', 'Member events must have a non-empty state_key');
    }
    
    // Basic content validation
    const content = rawEvent.content || {};
    
    // membership is required
    if (!content.membership) {
      logger.error(`Member event ${eventId} is missing required membership field`);
      return failure('M_MISSING_PARAM', 'Member events must specify a membership value');
    }
    
    // membership must be a valid value
    if (!Object.values(Membership).includes(content.membership)) {
      logger.error(`Member event ${eventId} has invalid membership value: ${content.membership}`);
      return failure('M_INVALID_PARAM', 
        `Invalid membership value: ${content.membership}. Must be one of: ${Object.values(Membership).join(', ')}`);
    }
    
    // Check for required auth events in auth_event_objects
    const { auth_event_objects } = event.authorizedEvent;
    if (!auth_event_objects || auth_event_objects.length === 0) {
      logger.error(`Member event ${eventId} is missing required auth events`);
      return failure('M_MISSING_AUTH_EVENTS', 'Member events must have auth events');
    }
    
    let createEvent = null;
    let joinRules = null;
    let powerLevels = null;
    let previousMembership = null;
    
    // Find the required auth events
    for (const authObj of auth_event_objects) {
      if (!authObj.event) continue;
      
      if (authObj.event.type === 'm.room.create' && authObj.event.state_key === '') {
        createEvent = authObj.event;
      } 
      else if (authObj.event.type === 'm.room.join_rules' && authObj.event.state_key === '') {
        joinRules = authObj.event;
      }
      else if (authObj.event.type === 'm.room.power_levels' && authObj.event.state_key === '') {
        powerLevels = authObj.event;
      }
      else if (authObj.event.type === 'm.room.member' && authObj.event.state_key === rawEvent.state_key) {
        previousMembership = authObj.event;
      }
    }
    
    // Always require create event
    if (!createEvent) {
      logger.error(`Member event ${eventId} missing required m.room.create event`);
      return failure('M_MISSING_AUTH_EVENTS', 'Member event must reference the room create event');
    }
    
    // Additional auth checks by membership type
    if (content.membership === Membership.JOIN) {
      // For join-only or invite-only rooms, we need join rules
      if (!joinRules) {
        logger.warn(`Join event ${eventId} missing join_rules event`);
        // Don't fail but warn
      } 
      else if (joinRules.content?.join_rule === 'invite' || joinRules.content?.join_rule === 'private') {
        // For invite-only or private rooms, check that user was invited
        if (rawEvent.sender !== createEvent.content?.creator) {
          // The original creator can always join without invite
          if (!previousMembership || previousMembership.content?.membership !== Membership.INVITE) {
            logger.error(`Join event ${eventId} for invite-only room without proper invitation`);
            return failure('M_FORBIDDEN', 'Cannot join invite-only room without invitation');
          }
        }
      }
    } 
    else if (content.membership === Membership.INVITE) {
      // Invites require power level check
      if (!powerLevels) {
        logger.warn(`Invite event ${eventId} missing power_levels event`);
        // Don't fail but warn
      } 
      else {
        // Check that user has permission to invite
        const invitePowerLevel = powerLevels.content?.invite ?? 50;
        const userPowerLevel = (powerLevels.content?.users?.[rawEvent.sender] ?? 
                              powerLevels.content?.users_default ?? 0);
                              
        if (userPowerLevel < invitePowerLevel) {
          logger.error(`Invite event ${eventId} sender ${rawEvent.sender} has insufficient power: ${userPowerLevel} < ${invitePowerLevel}`);
          return failure('M_FORBIDDEN', 'Sender does not have sufficient power level to invite');
        }
      }
    }
    
    // Validate invite events
    if (content.membership === Membership.INVITE) {
      // Check if this is a third-party invite
      if (content.third_party_invite) {
        // Validate third_party_invite structure
        if (typeof content.third_party_invite !== 'object') {
          logger.error(`Member event ${eventId} has invalid third_party_invite (not an object)`);
          return failure('M_INVALID_PARAM', 'third_party_invite must be an object');
        }
        
        // Must have signed section
        if (!content.third_party_invite.signed || typeof content.third_party_invite.signed !== 'object') {
          logger.error(`Member event ${eventId} has invalid third_party_invite.signed (missing or not an object)`);
          return failure('M_INVALID_PARAM', 'third_party_invite.signed must be an object');
        }
        
        // The signed section needs key fields
        const { signed } = content.third_party_invite;
        if (!signed.mxid || !signed.token || !signed.signatures) {
          logger.error(`Member event ${eventId} has invalid third_party_invite.signed (missing required fields)`);
          return failure('M_MISSING_PARAM', 'third_party_invite.signed must contain mxid, token, and signatures');
        }
        
        // The mxid should match the state_key
        if (signed.mxid !== rawEvent.state_key) {
          logger.error(`Member event ${eventId} has third_party_invite.signed.mxid (${signed.mxid}) that doesn't match state_key (${rawEvent.state_key})`);
          return failure('M_INVALID_PARAM', 'third_party_invite.signed.mxid must match the state_key');
        }
      }
    }
    
    // Check join_authorised_via_users_server if present
    if (content.join_authorised_via_users_server) {
      if (typeof content.join_authorised_via_users_server !== 'string') {
        logger.error(`Member event ${eventId} has invalid join_authorised_via_users_server (not a string)`);
        return failure('M_INVALID_PARAM', 'join_authorised_via_users_server must be a string');
      }
      
      // Should be a valid server name
      if (!content.join_authorised_via_users_server.includes('.')) {
        logger.warn(`Member event ${eventId} has suspicious join_authorised_via_users_server value: ${content.join_authorised_via_users_server}`);
        // We don't fail on this, just warn
      }
    }
    
    logger.debug(`Member event ${eventId} passed validation`);
    return success(event);
    
  } catch (error: any) {
    logger.error(`Error validating member event ${eventId}: ${error.message || String(error)}`);
    return failure('M_UNKNOWN', `Error validating member event: ${error.message || String(error)}`);
  }
}

export function registerMemberValidator(): void {
  registerEventHandler('m.room.member', validateMemberEvent);
} 