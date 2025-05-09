import { beforeEach, describe, expect, test } from 'bun:test';
import { RoomState } from './roomState';

describe('RoomState', () => {
  let roomState: RoomState;
  const roomId = '!test:example.org';

  beforeEach(() => {
    roomState = new RoomState(roomId);
  });

  function createEvent(overrides: Record<string, any> = {}): any {
    return {
      event_id: `$${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      room_id: roomId,
      sender: '@user1:example.org',
      origin_server_ts: Date.now(),
      type: 'm.room.message',
      content: {
        body: 'Test message',
        msgtype: 'm.text'
      },
      depth: 1,
      prev_events: [],
      auth_events: [],
      ...overrides
    };
  }

  function createStateEvent(type: string, stateKey: string, content: any, overrides: Record<string, any> = {}): any {
    return createEvent({
      type,
      state_key: stateKey,
      content,
      ...overrides
    });
  }

  async function addCreateRoomEvent(): Promise<any> {
    const createEvent = createStateEvent('m.room.create', '', {
      creator: '@user1:example.org',
      room_version: '6'
    });
    await roomState.addEvent(createEvent);
    return createEvent;
  }

  async function addPowerLevelsEvent(users: Record<string, number> = {}): Promise<any> {
    const plEvent = createStateEvent('m.room.power_levels', '', {
      users: {
        '@user1:example.org': 100,
        ...users
      },
      users_default: 0,
      events_default: 0,
      state_default: 50,
      ban: 50,
      kick: 50,
      redact: 50
    });
    await roomState.addEvent(plEvent);
    return plEvent;
  }

  // Test basic event addition
  test.only('should add a valid event', async () => {
    const event = createEvent();
    const result = await roomState.addEvent(event);
    expect(result).toBe(true);
    expect(roomState.getEvent(event.event_id)).toEqual(event);
  });

  // Test rejecting events with wrong room_id
  test('should reject events with incorrect room_id', async () => {
    const event = createEvent({ room_id: '!wrong:example.org' });
    const result = await roomState.addEvent(event);
    expect(result).toBe(false);
    expect(roomState.getEvent(event.event_id)).toBeNull();
  });

  // Test handling duplicate events
  test('should handle duplicate events', async () => {
    const event = createEvent();
    await roomState.addEvent(event);
    const result = await roomState.addEvent(event);
    expect(result).toBe(true); // Should succeed but not add again
  });

  // Test power level validation
  test('should enforce power level validation for state events', async () => {
    await addCreateRoomEvent();
    await addPowerLevelsEvent();

    // User2 can't send state events (requires PL 50)
    const event = createStateEvent('m.room.name', '', { name: 'Test Room' }, {
      sender: '@user2:example.org'
    });
    const result = await roomState.addEvent(event);
    expect(result).toBe(false);
  });

  // Test users can send events they have power level for
  test('should allow events when user has sufficient power level', async () => {
    await addCreateRoomEvent();
    await addPowerLevelsEvent({
      '@user2:example.org': 60
    });

    // User2 can now send state events
    const event = createStateEvent('m.room.name', '', { name: 'Test Room' }, {
      sender: '@user2:example.org'
    });
    const result = await roomState.addEvent(event);
    expect(result).toBe(true);
  });

  // Test membership changes
  test('should track membership changes', async () => {
    await addCreateRoomEvent();
    
    // Add join event
    const joinEvent = createStateEvent('m.room.member', '@user2:example.org', { 
      membership: 'join' 
    });
    await roomState.addEvent(joinEvent);
    
    expect(roomState.isUserJoined('@user2:example.org')).toBe(true);
    expect(roomState.getJoinedMembers()).toContain('@user2:example.org');
    
    // Add ban event
    const banEvent = createStateEvent('m.room.member', '@user2:example.org', { 
      membership: 'ban' 
    });
    await roomState.addEvent(banEvent);
    
    expect(roomState.isUserJoined('@user2:example.org')).toBe(false);
    expect(roomState.getBannedMembers()).toContain('@user2:example.org');
  });

  // Test banned users can't send events
  test('should reject events from banned users', async () => {
    await addCreateRoomEvent();
    
    // Ban user2
    const banEvent = createStateEvent('m.room.member', '@user2:example.org', { 
      membership: 'ban' 
    });
    await roomState.addEvent(banEvent);
    
    // Try to send message as banned user
    const msgEvent = createEvent({
      sender: '@user2:example.org'
    });
    const result = await roomState.addEvent(msgEvent);
    expect(result).toBe(false);
  });

  // Test DAG management
  test('should maintain forward and backward extremities', async () => {
    const event1 = createEvent();
    await roomState.addEvent(event1);
    
    expect(roomState.getForwardExtremities()).toContain(event1.event_id);
    
    // Add an event that references the first one
    const event2 = createEvent({
      prev_events: [[event1.event_id, {}]]
    });
    await roomState.addEvent(event2);
    
    // Forward extremities should update
    expect(roomState.getForwardExtremities()).not.toContain(event1.event_id);
    expect(roomState.getForwardExtremities()).toContain(event2.event_id);
    
    // Reference a non-existent event to create backward extremity
    const missingEventId = '$missing:example.org';
    const event3 = createEvent({
      prev_events: [[missingEventId, {}]]
    });
    await roomState.addEvent(event3);
    
    expect(roomState.getBackwardExtremities()).toContain(missingEventId);
  });

  // Test state resolution
  test('should resolve state correctly', async () => {
    const createEvent = await addCreateRoomEvent();
    const plEvent = await addPowerLevelsEvent();
    
    // Add a room name event
    const nameEvent = createStateEvent('m.room.name', '', { name: 'First Name' });
    await roomState.addEvent(nameEvent);
    
    // Add a newer room name event
    const nameEvent2 = createStateEvent('m.room.name', '', { name: 'Second Name' }, {
      origin_server_ts: Date.now() + 1000
    });
    await roomState.addEvent(nameEvent2);
    
    // Resolve state from all events
    const allEvents = [createEvent.event_id, plEvent.event_id, nameEvent.event_id, nameEvent2.event_id];
    const resolvedState = roomState.resolveState(allEvents);
    
    // Should have 3 state events (create, power_levels, and the newer name)
    expect(resolvedState.length).toBe(3);
    const resolvedName = resolvedState.find(e => e.type === 'm.room.name');
    expect(resolvedName.content.name).toBe('Second Name');
  });

  // Test depth tracking
  test('should track event depths', async () => {
    const event1 = createEvent({ depth: 1 });
    await roomState.addEvent(event1);
    
    const event2 = createEvent({ 
      depth: 2,
      event_id: `$${Date.now()}-${Math.floor(Math.random() * 1000)}-event2`
    });
    await roomState.addEvent(event2);
    
    // Add a small delay to ensure unique timestamp in event_id
    await new Promise(resolve => setTimeout(resolve, 5));
    
    const event3 = createEvent({ 
      depth: 2,
      event_id: `$${Date.now()}-${Math.floor(Math.random() * 1000)}-event3`
    });
    await roomState.addEvent(event3);
    
    expect(roomState.getMaxDepth()).toBe(2);
    expect(roomState.getEventsAtDepth(2).length).toBe(2);
  });

  // Test auth chain
  test('should return success when computing auth chains correctly', async () => {
    const roomCreateEvent = await addCreateRoomEvent();
    const plEvent = await addPowerLevelsEvent();
    
    // Create an event that references the create and power level events in its auth chain
    const messageEvent = createEvent({
      event_id: '$test:example.org',
      type: 'm.room.message',
      sender: '@alice:example.org',
      content: {},
      auth_events: [
        [roomCreateEvent.event_id, {}],
        [plEvent.event_id, {}]
      ],
      prev_events: []
    });
    await roomState.addEvent(messageEvent);
    
    const authChain = roomState.getAuthChain(messageEvent.event_id);
    expect(authChain.size).toBe(3); // The event itself plus the two auth events
    expect(authChain.has(roomCreateEvent.event_id)).toBe(true);
    expect(authChain.has(plEvent.event_id)).toBe(true);
  });

  // Test child event tracking
  test('should track child events', async () => {
    const event1 = createEvent();
    await roomState.addEvent(event1);
    
    const event2 = createEvent({
      prev_events: [[event1.event_id, {}]]
    });
    await roomState.addEvent(event2);
    
    const children = roomState.getChildEvents(event1.event_id);
    expect(children).toContain(event2.event_id);
  });
}); 