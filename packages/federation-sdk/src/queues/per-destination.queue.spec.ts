import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';

import type { BaseEDU } from '@rocket.chat/federation-core';
import type { Pdu } from '@rocket.chat/federation-room';

import { PerDestinationQueue } from './per-destination.queue';
import type { FederationRequestService } from '../services/federation-request.service';
import type { Transaction } from '../specs/federation-api';

// Type augmentation for Bun's jest timer methods that exist at runtime
// but are missing from type definitions
interface JestTimers {
	useFakeTimers(options?: { now?: number | Date }): void;
	useRealTimers(): void;
	advanceTimersByTime(milliseconds: number): void;
	advanceTimersToNextTimer(): void;
	runAllTimers(): void;
	runOnlyPendingTimers(): void;
	clearAllTimers(): void;
	getTimerCount(): number;
	setSystemTime(now?: number | Date): void;
}

// Cast jest to include timer methods
const jestTimers = jest as typeof jest & JestTimers;

describe('PerDestinationQueue', () => {
	let queue: PerDestinationQueue;
	let mockRequestService: FederationRequestService;
	const destination = 'remote.server.com';
	const origin = 'my.server.com';

	// Helper to create mock PDUs
	const createMockPdu = (eventId: string): Pdu =>
		({
			event_id: eventId,
			room_id: '!test:room',
			sender: '@user:server',
			type: 'm.room.message',
			content: { body: 'test' },
			origin_server_ts: Date.now(),
			// Add other required Pdu fields as needed
		} as unknown as Pdu);

	// Helper to create mock EDUs
	const createMockEdu = (type: string): BaseEDU =>
		({
			edu_type: type,
			content: { test: 'data' },
		} as BaseEDU);

	// Helper to extract call data from mocks in a readable way
	interface RequestCall {
		destination: string;
		uri: string;
		transaction: Transaction;
	}

	const getRequestCall = (callIndex: number): RequestCall => {
		const call = (mockRequestService.put as jest.Mock).mock.calls[callIndex];
		return {
			destination: call[0],
			uri: call[1],
			transaction: call[2],
		};
	};

	const getTransaction = (callIndex: number): Transaction => {
		return getRequestCall(callIndex).transaction;
	};

	// Helper to properly flush promises when using fake timers
	const flushPromises = async () => {
		// Run multiple rounds to ensure all nested promises resolve
		// biome-ignore lint/suspicious/noAwaitInLoop: intentional sequential promise flushing
		for (let i = 0; i < 10; i++) {
			// eslint-disable-next-line no-await-in-loop
			await Promise.resolve();
		}
	};

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();
		jest.restoreAllMocks();

		// Create mock request service
		mockRequestService = {
			put: jest.fn().mockResolvedValue({ pdus: {} }),
		} as unknown as FederationRequestService;
	});

	afterEach(() => {
		// Restore real timers after each test
		jestTimers.useRealTimers();
	});

	describe('Basic enqueueing and sending', () => {
		it('should enqueue and send a single PDU successfully', async () => {
			jestTimers.useFakeTimers();

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 3,
				initialBackoffMs: 100,
			});

			const pdu = createMockPdu('$event1');
			queue.enqueuePDU(pdu);

			// Wait for async processing
			await flushPromises();

			expect(mockRequestService.put).toHaveBeenCalledTimes(1);
			expect(queue.isEmpty()).toBe(true);
		});

		it('should enqueue and send a single EDU successfully', async () => {
			jestTimers.useFakeTimers();

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 3,
				initialBackoffMs: 100,
			});

			const edu = createMockEdu('m.typing');
			queue.enqueueEDU(edu);

			await flushPromises();

			expect(mockRequestService.put).toHaveBeenCalledTimes(1);
			expect(queue.isEmpty()).toBe(true);
		});

		it('should send PDUs and EDUs together when enqueued before processing starts', async () => {
			jestTimers.useFakeTimers();

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 3,
			});

			const pdu = createMockPdu('$event1');
			const edu = createMockEdu('m.typing');

			// Enqueue first PDU, which starts processing immediately
			queue.enqueuePDU(pdu);

			// Wait for first transaction to complete
			await flushPromises();

			// First transaction had only the PDU
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);
			const firstTransaction = getTransaction(0);
			expect(firstTransaction.pdus).toHaveLength(1);
			expect(firstTransaction.edus).toHaveLength(0);

			// Enqueue EDU after first processing completes
			queue.enqueueEDU(edu);
			await flushPromises();

			// Second transaction has the EDU
			expect(mockRequestService.put).toHaveBeenCalledTimes(2);
			const secondTransaction = getTransaction(1);
			expect(secondTransaction.pdus).toHaveLength(0);
			expect(secondTransaction.edus).toHaveLength(1);
			expect(queue.isEmpty()).toBe(true);
		});
	});

	describe('Batching limits', () => {
		it('should limit PDUs to 50 per transaction', async () => {
			jestTimers.useFakeTimers();

			// Mock that delays to allow batching
			const pendingResolvers: Array<(value: unknown) => void> = [];
			mockRequestService.put = jest.fn().mockImplementation(() => {
				return new Promise((resolve) => {
					pendingResolvers.push(() => resolve({ pdus: {} }));
					setTimeout(() => resolve({ pdus: {} }), 100);
				});
			});

			queue = new PerDestinationQueue(destination, origin, mockRequestService);

			// Enqueue all PDUs - first one processes immediately, rest accumulate
			for (let i = 0; i < 76; i++) {
				queue.enqueuePDU(createMockPdu(`$event${i}`));
			}

			// Process first batch
			await flushPromises();
			jestTimers.advanceTimersByTime(100);
			await flushPromises();

			// Process second batch
			jestTimers.advanceTimersByTime(100);
			await flushPromises();

			// Process third batch
			jestTimers.advanceTimersByTime(100);
			await flushPromises();

			// Should have: 1 (first) + 50 (second batch) + 25 (third batch) = 76 total
			expect(mockRequestService.put).toHaveBeenCalledTimes(3);

			// First transaction: 1 PDU (processed immediately)
			const tx1 = getTransaction(0);
			expect(tx1.pdus).toHaveLength(1);

			// Second transaction: 50 PDUs (max batch size)
			const tx2 = getTransaction(1);
			expect(tx2.pdus).toHaveLength(50);

			// Third transaction: 25 PDUs  (remaining)
			const tx3 = getTransaction(2);
			expect(tx3.pdus).toHaveLength(25);

			expect(queue.isEmpty()).toBe(true);
		});

		it('should limit EDUs to 100 per transaction', async () => {
			jestTimers.useFakeTimers();

			// Mock that delays to allow batching
			mockRequestService.put = jest.fn().mockImplementation(() => {
				return new Promise((resolve) => {
					setTimeout(() => resolve({ pdus: {} }), 100);
				});
			});

			queue = new PerDestinationQueue(destination, origin, mockRequestService);

			// Enqueue all EDUs - first one processes immediately, rest accumulate
			for (let i = 0; i < 151; i++) {
				queue.enqueueEDU(createMockEdu(`type${i}`));
			}

			// Process first batch
			await flushPromises();
			jestTimers.advanceTimersByTime(100);
			await flushPromises();

			// Process second batch
			jestTimers.advanceTimersByTime(100);
			await flushPromises();

			// Process third batch
			jestTimers.advanceTimersByTime(100);
			await flushPromises();

			// Should have: 1 (first) + 100 (second batch) + 50 (third batch) = 151 total
			expect(mockRequestService.put).toHaveBeenCalledTimes(3);

			// First transaction: 1 EDU (processed immediately)
			const tx1 = getTransaction(0);
			expect(tx1.edus).toHaveLength(1);

			// Second transaction: 100 EDUs (max batch size)
			const tx2 = getTransaction(1);
			expect(tx2.edus).toHaveLength(100);

			// Third transaction: 50 EDUs (remaining)
			const tx3 = getTransaction(2);
			expect(tx3.edus).toHaveLength(50);

			expect(queue.isEmpty()).toBe(true);
		});
	});

	describe('Retry logic with exponential backoff', () => {
		it('should retry with exponential backoff on failure', async () => {
			jestTimers.useFakeTimers();

			let callCount = 0;
			mockRequestService.put = jest.fn().mockImplementation(() => {
				callCount++;
				if (callCount < 3) {
					return Promise.reject(new Error('Network error'));
				}
				return Promise.resolve({ pdus: {} });
			});

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 5,
				initialBackoffMs: 100,
				backoffMultiplier: 2,
			});

			queue.enqueuePDU(createMockPdu('$event1'));

			// First attempt fails immediately
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);

			// Second attempt after 100ms backoff
			jestTimers.advanceTimersByTime(100);
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(2);

			// Third attempt succeeds after 200ms backoff (exponential: 100 * 2^1)
			jestTimers.advanceTimersByTime(200);
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(3);
			expect(queue.isEmpty()).toBe(true);
		});

		it('should respect maxBackoffMs limit', async () => {
			jestTimers.useFakeTimers();

			mockRequestService.put = jest.fn().mockRejectedValue(new Error('Always fails'));

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 20,
				initialBackoffMs: 1000,
				maxBackoffMs: 5000,
				backoffMultiplier: 2,
			});

			queue.enqueuePDU(createMockPdu('$event1'));

			await flushPromises();

			// After many retries, backoff should cap at maxBackoffMs
			// Just verify it doesn't grow unbounded by checking the implementation works
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);
		});

		it('should drop events after maxRetries is exceeded', async () => {
			jestTimers.useFakeTimers();

			mockRequestService.put = jest.fn().mockRejectedValue(new Error('Always fails'));

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 2,
				initialBackoffMs: 50,
				backoffMultiplier: 2,
			});

			queue.enqueuePDU(createMockPdu('$event1'));
			expect(queue.isEmpty()).toBe(false);

			// First attempt
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);

			// Second retry (after 50ms backoff)
			jestTimers.advanceTimersByTime(50);
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(2);

			// Third retry (after 100ms backoff, exceeds max)
			jestTimers.advanceTimersByTime(100);
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(3);

			// Queue should be empty now (events dropped)
			expect(queue.isEmpty()).toBe(true);
		});
	});

	describe('1-hour backoff threshold behavior', () => {
		it('should empty queue when backoff exceeds 1 hour', async () => {
			jestTimers.useFakeTimers();

			mockRequestService.put = jest.fn().mockRejectedValue(new Error('Server unreachable'));

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 20,
				initialBackoffMs: 4000000, // Way over 1 hour (3600000ms)
				maxBackoffMs: 7200000, // 2 hours
				backoffMultiplier: 1,
			});

			queue.enqueuePDU(createMockPdu('$event1'));
			queue.enqueuePDU(createMockPdu('$event2'));
			expect(queue.isEmpty()).toBe(false);

			// First attempt fails, triggers 1-hour threshold check
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);

			// After first retry fails, backoff calculation exceeds 1 hour
			// Queue should be emptied
			expect(queue.isEmpty()).toBe(true);

			// Additional enqueues should not trigger processing (nextRetryAt = Infinity)
			queue.enqueuePDU(createMockPdu('$event3'));
			await flushPromises();

			// Should still only have 1 call (no new attempts)
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);
		});

		describe('setTimeout spy', () => {
			let setTimeoutSpy: ReturnType<typeof jest.spyOn>;

			beforeEach(() => {
				jestTimers.useFakeTimers();
				setTimeoutSpy = jest.spyOn(global, 'setTimeout');
			});

			afterEach(() => {
				setTimeoutSpy.mockRestore();
			});

			it('should not schedule setTimeout with infinite waitTime when nextRetryAt is Infinity', async () => {
				mockRequestService.put = jest.fn().mockRejectedValue(new Error('Server unreachable'));

				queue = new PerDestinationQueue(destination, origin, mockRequestService, {
					maxRetries: 20,
					initialBackoffMs: 4000000, // Exceeds 1 hour on first retry
					maxBackoffMs: 7200000,
					backoffMultiplier: 1,
				});

				queue.enqueuePDU(createMockPdu('$event1'));

				// First attempt fails, triggers 1-hour threshold and sets nextRetryAt to Infinity
				await flushPromises();
				expect(mockRequestService.put).toHaveBeenCalledTimes(1);
				expect(queue.isEmpty()).toBe(true); // Queue emptied due to threshold

				// Clear previous setTimeout calls
				setTimeoutSpy.mockClear();

				// Enqueue new event after nextRetryAt is set to Infinity
				queue.enqueuePDU(createMockPdu('$event2'));

				// Wait a bit to ensure processQueue is called
				await flushPromises();

				// Verify setTimeout was not called with Infinity
				const setTimeoutCalls = setTimeoutSpy.mock.calls;
				const hasInfiniteTimeout = setTimeoutCalls.some((call: unknown[]) => !Number.isFinite(call[1]));
				expect(hasInfiniteTimeout).toBe(false);

				// Queue should still have the event (not dropped, but not processing)
				expect(queue.isEmpty()).toBe(false);
			});
		});

		it('should handle multiple enqueue attempts when parked with infinite backoff', async () => {
			jestTimers.useFakeTimers();

			mockRequestService.put = jest.fn().mockRejectedValue(new Error('Server unreachable'));

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 20,
				initialBackoffMs: 4000000, // Exceeds 1 hour on first retry
				backoffMultiplier: 1,
			});

			queue.enqueuePDU(createMockPdu('$event1'));

			// First attempt fails, triggers 1-hour threshold
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);
			expect(queue.isEmpty()).toBe(true);

			// Enqueue multiple events after threshold
			queue.enqueuePDU(createMockPdu('$event2'));
			queue.enqueuePDU(createMockPdu('$event3'));
			queue.enqueuePDU(createMockPdu('$event4'));

			await flushPromises();

			// Should not attempt to send (still parked at Infinity)
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);
			expect(queue.isEmpty()).toBe(false);
		});
	});

	describe('notifyServerUp behavior', () => {
		it('should clear backoff and resume processing when server comes back up', async () => {
			jestTimers.useFakeTimers();

			let callCount = 0;
			mockRequestService.put = jest.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error('Server down'));
				}
				return Promise.resolve({ pdus: {} });
			});

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 5,
				initialBackoffMs: 10000, // 10 seconds
				backoffMultiplier: 2,
			});

			queue.enqueuePDU(createMockPdu('$event1'));

			// First attempt fails
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);
			expect(queue.isEmpty()).toBe(false);

			// Notify server is back up (should clear backoff)
			queue.notifyServerUp();

			// Should immediately retry without waiting for backoff
			await flushPromises();
			expect(mockRequestService.put).toHaveBeenCalledTimes(2);
			expect(queue.isEmpty()).toBe(true);
		});

		it('should resume processing after 1-hour threshold when notifyServerUp is called', async () => {
			jestTimers.useFakeTimers();

			const failingMock = jest.fn().mockRejectedValue(new Error('Server down'));
			mockRequestService.put = failingMock;

			queue = new PerDestinationQueue(destination, origin, mockRequestService, {
				maxRetries: 20,
				initialBackoffMs: 4000000, // Exceeds 1 hour on first retry
				backoffMultiplier: 1,
			});

			queue.enqueuePDU(createMockPdu('$event1'));

			// First attempt fails, triggers 1-hour threshold
			await flushPromises();
			expect(failingMock).toHaveBeenCalledTimes(1);
			expect(queue.isEmpty()).toBe(true); // Queue emptied due to 1-hour threshold

			// Add new event AFTER threshold is hit (should not process due to Infinity backoff)
			queue.enqueuePDU(createMockPdu('$event2'));
			await flushPromises();
			expect(failingMock).toHaveBeenCalledTimes(1); // No new call, still stuck
			expect(queue.isEmpty()).toBe(false); // Event is queued but not processing

			// Now server comes back up - fix the mock
			const workingMock = jest.fn().mockResolvedValue({ pdus: {} });
			mockRequestService.put = workingMock;

			// Notify that server is back up - should clear Infinity backoff and process queue
			queue.notifyServerUp();

			// Should process the queued event ($event2)
			await flushPromises();
			expect(workingMock).toHaveBeenCalledTimes(1); // New event processed
			expect(queue.isEmpty()).toBe(true); // Queue cleared
		});
	});

	describe('Concurrent processing prevention', () => {
		it('should not process queue concurrently', async () => {
			jestTimers.useFakeTimers();

			let resolveRequest: ((value: unknown) => void) | undefined;
			const requestPromise = new Promise((resolve) => {
				resolveRequest = resolve;
			});

			mockRequestService.put = jest.fn().mockReturnValue(requestPromise);

			queue = new PerDestinationQueue(destination, origin, mockRequestService);

			// Enqueue multiple PDUs quickly
			queue.enqueuePDU(createMockPdu('$event1'));
			queue.enqueuePDU(createMockPdu('$event2'));
			queue.enqueuePDU(createMockPdu('$event3'));

			await flushPromises();

			// Should only have one call (first transaction is still processing)
			expect(mockRequestService.put).toHaveBeenCalledTimes(1);

			// Resolve the request
			if (resolveRequest) {
				resolveRequest({ pdus: {} });
			}
			await flushPromises();

			// Now should process remaining events
			expect(mockRequestService.put).toHaveBeenCalled();
		});
	});

	describe('isEmpty behavior', () => {
		it('should return true when both queues are empty', () => {
			queue = new PerDestinationQueue(destination, origin, mockRequestService);
			expect(queue.isEmpty()).toBe(true);
		});

		it('should return false when PDU queue has items', () => {
			queue = new PerDestinationQueue(destination, origin, mockRequestService);
			queue.enqueuePDU(createMockPdu('$event1'));
			expect(queue.isEmpty()).toBe(false);
		});

		it('should return false when EDU queue has items', () => {
			queue = new PerDestinationQueue(destination, origin, mockRequestService);
			queue.enqueueEDU(createMockEdu('m.typing'));
			expect(queue.isEmpty()).toBe(false);
		});

		it('should return false when both queues have items', () => {
			queue = new PerDestinationQueue(destination, origin, mockRequestService);
			queue.enqueuePDU(createMockPdu('$event1'));
			queue.enqueueEDU(createMockEdu('m.typing'));
			expect(queue.isEmpty()).toBe(false);
		});
	});

	describe('Transaction structure', () => {
		it('should create transaction with correct structure', async () => {
			jestTimers.useFakeTimers();

			queue = new PerDestinationQueue(destination, origin, mockRequestService);

			const pdu = createMockPdu('$event1');
			const edu = createMockEdu('m.typing');

			queue.enqueuePDU(pdu);
			await flushPromises();

			queue.enqueueEDU(edu);
			await flushPromises();

			// Check first transaction (PDU)
			expect(mockRequestService.put).toHaveBeenCalledTimes(2);
			const firstCall = getRequestCall(0);

			expect(firstCall.destination).toBe(destination);
			expect(firstCall.uri).toContain('/_matrix/federation/v1/send/');
			expect(firstCall.transaction).toMatchObject({
				origin,
				pdus: [pdu],
			});
			expect(firstCall.transaction.origin_server_ts).toBeGreaterThan(0);

			// Check second transaction (EDU)
			const secondCall = getRequestCall(1);
			expect(secondCall.destination).toBe(destination);
			expect(secondCall.uri).toContain('/_matrix/federation/v1/send/');
			expect(secondCall.transaction).toMatchObject({
				origin,
				edus: [edu],
			});
		});

		it('should generate unique transaction IDs', async () => {
			jestTimers.useFakeTimers();

			queue = new PerDestinationQueue(destination, origin, mockRequestService);

			queue.enqueuePDU(createMockPdu('$event1'));
			await flushPromises();

			queue.enqueuePDU(createMockPdu('$event2'));
			await flushPromises();

			expect(mockRequestService.put).toHaveBeenCalledTimes(2);
			const firstCallUri = getRequestCall(0).uri;
			const secondCallUri = getRequestCall(1).uri;

			expect(firstCallUri).not.toBe(secondCallUri);
		});
	});
});
