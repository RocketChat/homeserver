import { Logger } from "../utils/logger";
import { EventType } from "../validation/pipelines";

const logger = new Logger("RoomState");

export interface PowerLevels {
  ban?: number;
  kick?: number;
  invite?: number;
  redact?: number;
  events?: Record<string, number>;
  state_default?: number;
  events_default?: number;
  users_default?: number;
  users?: Record<string, number>;
  notifications?: Record<string, number>;
}

export class RoomState {
  private eventMap: Map<string, any> = new Map();
  private stateEvents: Map<string, any> = new Map();
  private powerLevels: PowerLevels | null = null;

  private authEvents: Map<string, Set<string>> = new Map();
  private prevEvents: Map<string, Set<string>> = new Map();
  private forwardExtremities: Set<string> = new Set();
  private backwardExtremities: Set<string> = new Set();
  
  private eventDepths: Map<string, number> = new Map();
  private depthToEvents: Map<number, Set<string>> = new Map();
  private maxDepth = 0;
  
  private roomVersion = "10";
  private roomCreator: string | null = null; 
  private joinedMembers: Set<string> = new Set();
  private invitedMembers: Set<string> = new Set();
  private bannedMembers: Set<string> = new Set();
  
  private roomId: string;

  constructor(roomId: string) {
    this.roomId = roomId;
    logger.info(`RoomState initialized for room ${roomId}`);
  }

  public async addEvent({ eventId, event }: EventType): Promise<boolean> {
    if (event.room_id !== this.roomId) {
      logger.warn(`Attempted to add event from room ${event.room_id} to room ${this.roomId}`);
      return false;
    }

    if (this.eventMap.has(eventId)) {
      logger.debug(`Event ${eventId} already exists in room state`);
      return true;
    }

    try {
      await this.validateEventAgainstAuthChain(event);
      this.checkAndMarkBackwardExtremities(event);
      this.eventMap.set(eventId, event);

      const depth = event.depth || 0;
      this.eventDepths.set(eventId, depth);
      if (!this.depthToEvents.has(depth)) {
        this.depthToEvents.set(depth, new Set());
      }
      this.depthToEvents.get(depth)?.add(eventId);
      
      if (depth > this.maxDepth) {
        this.maxDepth = depth;
      }

      this.trackAuthChain(event);
      this.trackPrevEvents(event);
      this.updateForwardExtremities(event);

      if (this.isStateEvent(event)) {
        await this.processStateEvent(event);
      }

      if (event.type === "m.room.member") {
        this.processMembershipChange(event);
      }
      
      logger.debug(`Added event ${eventId} to room ${this.roomId}`);
      return true;
    } catch (error: any) {
      logger.warn(`Failed to add event ${eventId}: ${error.message}`);
      logger.debug(event);
      logger.debug(error);
      return false;
    }
  }

  private processMembershipChange(event: any): void {
    if (event.type !== "m.room.member" || !event.state_key) {
      return;
    }
    
    const userId = event.state_key;
    const membership = event.content?.membership;
    
    this.joinedMembers.delete(userId);
    this.invitedMembers.delete(userId);
    this.bannedMembers.delete(userId);
    
    if (membership === "join") {
      this.joinedMembers.add(userId);
    } else if (membership === "invite") {
      this.invitedMembers.add(userId);
    } else if (membership === "ban") {
      this.bannedMembers.add(userId);
    }
    
    if (membership === "join" && !this.roomCreator) {
      const createEvent = this.getStateEvent("m.room.create", "");
      if (createEvent?.content?.creator === userId) {
        this.roomCreator = userId;
      }
    }
  }

  private async processStateEvent(event: any): Promise<void> {
    const stateKey = `${event.type}|${event.state_key}`;
    
    if (event.type === "m.room.power_levels") {
      this.powerLevels = event.content;
    } else if (event.type === "m.room.create") {
      this.roomVersion = event.content?.room_version;
    }
    
    this.stateEvents.set(stateKey, event);
  }

  private trackAuthChain(event: any): void {
    const authEventIds = this.getAuthEventIds(event);
    this.authEvents.set(event.event_id, new Set(authEventIds));
  }
  
  private trackPrevEvents(event: any): void {
    const prevEventIds = this.getPrevEventIds(event);
    this.prevEvents.set(event.event_id, new Set(prevEventIds));
  }

  private async validateEventAgainstAuthChain(event: any): Promise<void> {
    const authEventIds = this.getAuthEventIds(event);
    
    for (const authId of authEventIds) {
      if (!this.eventMap.has(authId)) {
        // In a real implementation, we would fetch missing auth events
        logger.warn(`Auth event ${authId} not found for event ${event.event_id}`);
        this.backwardExtremities.add(authId);
      }
    }
    
    // Implement auth rules according to Matrix spec
    // https://matrix.org/docs/spec/server_server/latest#checks-performed-on-receipt-of-a-pdu
    
    this.validateBasicEventRules(event);
    
    if (this.powerLevels) {
      this.validateEventAgainstPowerLevels(event);
    }
    
    if (this.isStateEvent(event)) {
      await this.validateStateEvent(event);
    }
  }

  private async validateStateEvent(event: any): Promise<void> {
    // TODO:
    // 1. If this is a redaction, check the sender has permission to redact
    // 2. If this changes membership, check the sender has permission for that specific change
    // 3. Validate the state transition is allowed by Matrix spec
    
    if (event.type === "m.room.power_levels") {
      const currentPowerLevels = this.powerLevels;
      if (currentPowerLevels) {
        const senderPower = this.getUserPowerLevel(event.sender);
        
        const newUsers = event.content?.users || {};
        const currentUsers = currentPowerLevels.users || {};
        
        for (const [userId, newLevel] of Object.entries(newUsers)) {
          const currentLevel = currentUsers[userId] || currentPowerLevels.users_default || 0;
          if ((newLevel as number) > senderPower || currentLevel > senderPower) {
            throw new Error("Cannot change power levels higher than your own");
          }
        }
      }
    }
  }

  private validateEventAgainstPowerLevels(event: any): void {
    const senderPower = this.getUserPowerLevel(event.sender);
    
    if (this.isStateEvent(event)) {
      const requiredPower = this.getRequiredPowerLevelForState(event.type);
      if (senderPower < requiredPower) {
        throw new Error(`Sender power level ${senderPower} is lower than required level ${requiredPower} for state event ${event.type}`);
      }
    } else {
      const requiredPower = this.getRequiredPowerLevelForEvent(event.type);
      if (senderPower < requiredPower) {
        throw new Error(`Sender power level ${senderPower} is lower than required level ${requiredPower} for event ${event.type}`);
      }
    }
  }

  private getUserPowerLevel(userId: string): number {
    if (!this.powerLevels) {
      return 0;
    }
    
    return this.powerLevels.users?.[userId] ?? this.powerLevels.users_default ?? 0;
  }

  private getRequiredPowerLevelForState(eventType: string): number {
    if (!this.powerLevels) {
      return 50; // Default in Matrix spec
    }
    
    return this.powerLevels.events?.[eventType] ?? this.powerLevels.state_default ?? 50;
  }

  private getRequiredPowerLevelForEvent(eventType: string): number {
    if (!this.powerLevels) {
      return 0; // Default in Matrix spec
    }
    
    return this.powerLevels.events?.[eventType] ?? this.powerLevels.events_default ?? 0;
  }

  private getAuthEventIds(event: any): string[] {
    if (!event.auth_events || !Array.isArray(event.auth_events)) {
      return [];
    }
    return event.auth_events.map((authEvent: any) => 
      Array.isArray(authEvent) ? authEvent[0] : authEvent
    );
  }

  private getPrevEventIds(event: any): string[] {
    if (!event.prev_events || !Array.isArray(event.prev_events)) {
      return [];
    }
    return event.prev_events.map((prevEvent: any) => 
      Array.isArray(prevEvent) ? prevEvent[0] : prevEvent
    );
  }

  private validateBasicEventRules(event: any): void {
    if (!event.event_id) {
      throw new Error("Event missing event_id");
    }
    
    if (!event.room_id) {
      throw new Error("Event missing room_id");
    }
    
    if (!event.sender) {
      throw new Error("Event missing sender");
    }
    
    if (!event.origin_server_ts) {
      throw new Error("Event missing origin_server_ts");
    }
    
    if (event.room_id !== this.roomId) {
      throw new Error(`Event room_id ${event.room_id} does not match expected ${this.roomId}`);
    }
    
    const now = Date.now();
    const eventTime = event.origin_server_ts;
    
    if (eventTime > now + 5 * 60 * 1000) { // 5 minutes in the future
      throw new Error("Event timestamp too far in the future");
    }
    
    if (this.bannedMembers.has(event.sender)) {
      throw new Error("Sender is banned from the room");
    }
  }

  private checkAndMarkBackwardExtremities(event: any): void {
    const prevEventIds = this.getPrevEventIds(event);
    
    for (const prevEventId of prevEventIds) {
      if (!this.eventMap.has(prevEventId)) {
        logger.debug(`Adding backward extremity: ${prevEventId}`);
        this.backwardExtremities.add(prevEventId);
      }
    }
  }

  private updateForwardExtremities(event: any): void {
    const prevEventIds = this.getPrevEventIds(event);
    
    // If this event has no prev_events, it's a new forward extremity
    if (prevEventIds.length === 0) {
      this.forwardExtremities.add(event.event_id);
      return;
    }
    
    for (const prevEventId of prevEventIds) {
      this.forwardExtremities.delete(prevEventId);
    }
    
    this.forwardExtremities.add(event.event_id);
  }

  private isStateEvent(event: any): boolean {
    return event.type && event.hasOwn('state_key');
  }

  public resolveState(eventIds: string[]): any[] {
    // TODO: use the appropriate state resolution algorithm based on the room version
    
    // Simplified algorithm:
    // 1. Collect all state events referenced by the given event IDs
    // 2. For each (type, state_key), pick the most recent event by origin_server_ts
    
    const stateMap = new Map<string, any>();
    
    for (const eventId of eventIds) {
      const event = this.eventMap.get(eventId);
      if (event && this.isStateEvent(event)) {
        const key = `${event.type}|${event.state_key}`;
        const existing = stateMap.get(key);
        
        if (!existing || event.origin_server_ts > existing.origin_server_ts) {
          stateMap.set(key, event);
        }
      }
    }
    
    return Array.from(stateMap.values());
  }

  public getStateEvents(): any[] {
    return Array.from(this.stateEvents.values());
  }

  public getStateEvent(type: string, stateKey: string): any | null {
    const key = `${type}|${stateKey}`;
    return this.stateEvents.get(key) || null;
  }

  public getForwardExtremities(): string[] {
    return Array.from(this.forwardExtremities);
  }

  public getBackwardExtremities(): string[] {
    return Array.from(this.backwardExtremities);
  }

  public getEvent(eventId: string): any | null {
    return this.eventMap.get(eventId) || null;
  }

  public getAllEvents(): any[] {
    return Array.from(this.eventMap.values());
  }
  
  public getEventsAtDepth(depth: number): any[] {
    const eventIds = this.depthToEvents.get(depth) || new Set();
    return Array.from(eventIds).map(id => this.eventMap.get(id)).filter(Boolean);
  }

  public getMaxDepth(): number {
    return this.maxDepth;
  }
  
  public getRoomId(): string {
    return this.roomId;
  }
  
  public getRoomVersion(): string {
    return this.roomVersion;
  }
  
  public getJoinedMembers(): string[] {
    return Array.from(this.joinedMembers);
  }
  
  public getInvitedMembers(): string[] {
    return Array.from(this.invitedMembers);
  }
  
  public getBannedMembers(): string[] {
    return Array.from(this.bannedMembers);
  }
  
  public isUserJoined(userId: string): boolean {
    return this.joinedMembers.has(userId);
  }

  public getAuthChain(eventId: string): Set<string> {
    const result = new Set<string>();
    const toProcess = [eventId];
    
    while (toProcess.length > 0) {
      const currentId = toProcess.pop()!;
      result.add(currentId);
      
      const authEvents = this.authEvents.get(currentId);
      if (authEvents) {
        for (const authId of authEvents) {
          if (!result.has(authId)) {
            toProcess.push(authId);
          }
        }
      }
    }
    
    return result;
  }
  
  public getChildEvents(eventId: string): string[] {
    const children: string[] = [];
    
    for (const [id, prevEvents] of this.prevEvents.entries()) {
      if (prevEvents.has(eventId)) {
        children.push(id);
      }
    }
    
    return children;
  }
} 