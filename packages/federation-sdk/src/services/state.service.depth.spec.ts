import { expect, test, mock } from 'bun:test';
import { StateService } from './state.service';
import { PersistentEventFactory } from '@hs/room';

// Mock dependencies
const mockStateRepository = {
	getByRoomIdAndIdentifier: mock(() => ({
		delta: { eventId: 'test-event-id' }
	}))
};

const mockEventRepository = {
	findById: mock(() => ({
		event: { content: { room_version: '10' } }
	})),
	findByRoomIdAndType: mock(() => ({
		event: { content: { room_version: '10' } }
	})),
	findPrevEvents: mock(() => [])
};

const mockConfigService = {
	getSigningKey: mock(() => [{ algorithm: 'ed25519', version: 'a', key: 'test' }]),
	serverName: 'test.com'
};

test('StateService.addPrevEvents should calculate depth correctly', async () => {
	const stateService = new StateService(
		mockStateRepository as any,
		mockEventRepository as any,
		mockConfigService as any
	);

	// Create a test event
	const testEvent = PersistentEventFactory.newMessageEvent(
		'!test:example.com',
		'@test:example.com',
		'test message'
	);

	// Mock previous events with different depths
	const prevEvent1 = {
		event: {
			type: 'm.room.message',
			depth: 5,
			// ... other required fields for a valid event
			room_id: '!test:example.com',
			sender: '@test:example.com',
			origin_server_ts: Date.now(),
			content: { msgtype: 'm.text', body: 'prev1' },
			prev_events: [],
			auth_events: []
		}
	};

	const prevEvent2 = {
		event: {
			type: 'm.room.message',
			depth: 8,
			// ... other required fields for a valid event
			room_id: '!test:example.com',
			sender: '@test:example.com',
			origin_server_ts: Date.now(),
			content: { msgtype: 'm.text', body: 'prev2' },
			prev_events: [],
			auth_events: []
		}
	};

	const prevEvent3 = {
		event: {
			type: 'm.room.message',
			depth: 3,
			// ... other required fields for a valid event
			room_id: '!test:example.com',
			sender: '@test:example.com',
			origin_server_ts: Date.now(),
			content: { msgtype: 'm.text', body: 'prev3' },
			prev_events: [],
			auth_events: []
		}
	};

	// Mock findPrevEvents to return our test events
	mockEventRepository.findPrevEvents.mockReturnValue([prevEvent1, prevEvent2, prevEvent3]);

	// Verify initial depth is 0
	expect(testEvent.depth).toBe(0);

	// Call addPrevEvents
	await stateService.addPrevEvents(testEvent);

	// Verify depth is calculated as max(5, 8, 3) + 1 = 9
	expect(testEvent.depth).toBe(9);
});

test('StateService.addPrevEvents should keep depth 0 when no previous events', async () => {
	const stateService = new StateService(
		mockStateRepository as any,
		mockEventRepository as any,
		mockConfigService as any
	);

	// Create a test event
	const testEvent = PersistentEventFactory.newCreateEvent(
		'@creator:example.com',
		'10'
	);

	// Mock no previous events (like for room creation)
	mockEventRepository.findPrevEvents.mockReturnValue([]);

	// Verify initial depth is 0
	expect(testEvent.depth).toBe(0);

	// Call addPrevEvents
	await stateService.addPrevEvents(testEvent);

	// Verify depth remains 0 for create events with no previous events
	expect(testEvent.depth).toBe(0);
});

test('StateService.addPrevEvents should handle sequential events correctly', async () => {
	const stateService = new StateService(
		mockStateRepository as any,
		mockEventRepository as any,
		mockConfigService as any
	);

	// Simulate a sequence of events being created and processed
	const createEvent = PersistentEventFactory.newCreateEvent(
		'@creator:example.com',
		'10'
	);

	// First event after create (should have depth 1)
	const powerLevelsEvent = PersistentEventFactory.newPowerLevelEvent(
		createEvent.roomId,
		'@creator:example.com',
		{ users: { '@creator:example.com': 100 }, users_default: 0 },
		'10'
	);

	// Mock findPrevEvents to return the create event (depth 0)
	mockEventRepository.findPrevEvents.mockReturnValue([{
		event: {
			...createEvent.event,
			depth: 0,
		}
	}]);

	await stateService.addPrevEvents(powerLevelsEvent);
	expect(powerLevelsEvent.depth).toBe(1);

	// Second event after power levels (should have depth 2)
	const memberEvent = PersistentEventFactory.newMembershipEvent(
		createEvent.roomId,
		'@creator:example.com',
		'@creator:example.com',
		'join',
		createEvent.getContent()
	);

	// Mock findPrevEvents to return the power levels event (depth 1)
	mockEventRepository.findPrevEvents.mockReturnValue([{
		event: {
			...powerLevelsEvent.event,
			depth: 1,
		}
	}]);

	await stateService.addPrevEvents(memberEvent);
	expect(memberEvent.depth).toBe(2);
});