import { beforeEach, describe, expect, test } from 'bun:test';
import { container } from 'tsyringe';
import {
	Lock,
	LockManagerService,
	type MemoryLockConfig,
	type NatsLockConfig,
} from './lock.decorator';

describe('Lock Decorator', () => {
	beforeEach(() => {
		// Clear the container and register the service fresh for each test
		container.clearInstances();
		container.register(LockManagerService, {
			useFactory: () => new LockManagerService({ type: 'memory' }),
		});
	});

	describe('Basic Locking Functionality', () => {
		test('should allow sequential execution of locked methods', async () => {
			class TestService {
				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processUser(userId: string): Promise<string> {
					await new Promise((resolve) => setTimeout(resolve, 50));
					return `processed-${userId}`;
				}
			}

			const service = new TestService();
			const result1 = await service.processUser('user1');
			const result2 = await service.processUser('user2');

			expect(result1).toBe('processed-user1');
			expect(result2).toBe('processed-user2');
		});

		test('should prevent concurrent execution for same key', async () => {
			const executionOrder: string[] = [];

			class TestService {
				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processUser(userId: string): Promise<string> {
					executionOrder.push(`start-${userId}`);
					await new Promise((resolve) => setTimeout(resolve, 100));
					executionOrder.push(`end-${userId}`);
					return `processed-${userId}`;
				}
			}

			const service = new TestService();

			const promise1 = service.processUser('user1');
			const promise2 = service.processUser('user1');

			await Promise.all([promise1, promise2]);

			expect(executionOrder).toEqual([
				'start-user1',
				'end-user1',
				'start-user1',
				'end-user1',
			]);
		});

		test('should allow concurrent execution for different keys', async () => {
			const executionOrder: string[] = [];

			class TestService {
				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processUser(userId: string): Promise<string> {
					executionOrder.push(`start-${userId}`);
					await new Promise((resolve) => setTimeout(resolve, 100));
					executionOrder.push(`end-${userId}`);
					return `processed-${userId}`;
				}
			}

			const service = new TestService();

			const promise1 = service.processUser('user1');
			const promise2 = service.processUser('user2');

			await Promise.all([promise1, promise2]);

			expect(executionOrder).toContain('start-user1');
			expect(executionOrder).toContain('start-user2');
			expect(executionOrder).toContain('end-user1');
			expect(executionOrder).toContain('end-user2');
		});
	});

	describe('Key Extraction', () => {
		test('should extract key from simple string parameter', async () => {
			class TestService {
				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processUser(userId: string): Promise<string> {
					return `processed-${userId}`;
				}
			}

			const service = new TestService();
			const result = await service.processUser('test-user');
			expect(result).toBe('processed-test-user');
		});

		test('should extract key from object property', async () => {
			class TestService {
				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processRequest(request: {
					userId: string;
					action: string;
				}): Promise<string> {
					return `processed-${request.userId}`;
				}
			}

			const service = new TestService();
			const result = await service.processRequest({
				userId: 'test-user',
				action: 'update',
			});
			expect(result).toBe('processed-test-user');
		});

		test('should extract key from nested object path', async () => {
			class TestService {
				@Lock({ timeout: 1000, keyPath: 'request.userId' })
				async processData(data: {
					request: { userId: string; data: any };
				}): Promise<string> {
					return `processed-${data.request.userId}`;
				}
			}

			const service = new TestService();
			const result = await service.processData({
				request: { userId: 'nested-user', data: {} },
			});
			expect(result).toBe('processed-nested-user');
		});

		test('should throw error for invalid key path', async () => {
			class TestService {
				@Lock({ timeout: 1000, keyPath: 'nonexistent' })
				async processUser(userId: string): Promise<string> {
					return `processed-${userId}`;
				}
			}

			const service = new TestService();

			await expect(service.processUser('test-user')).rejects.toThrow(
				'Could not find parameter',
			);
		});

		test('should throw error for null/undefined in path', async () => {
			class TestService {
				@Lock({ timeout: 1000, keyPath: 'request.userId' })
				async processData(_data: { request: null }): Promise<string> {
					return 'processed';
				}
			}

			const service = new TestService();

			await expect(service.processData({ request: null })).rejects.toThrow(
				'leads to null/undefined value',
			);
		});
	});

	describe('Error Handling', () => {
		test('should release lock even if method throws error', async () => {
			const executionOrder: string[] = [];

			class TestService {
				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processUser(
					userId: string,
					shouldThrow = false,
				): Promise<string> {
					executionOrder.push(`start-${userId}`);
					if (shouldThrow) {
						throw new Error('Test error');
					}
					await new Promise((resolve) => setTimeout(resolve, 50));
					executionOrder.push(`end-${userId}`);
					return `processed-${userId}`;
				}
			}

			const service = new TestService();

			await expect(service.processUser('user1', true)).rejects.toThrow(
				'Test error',
			);

			const result = await service.processUser('user1', false);

			expect(result).toBe('processed-user1');
			expect(executionOrder).toEqual([
				'start-user1',
				'start-user1',
				'end-user1',
			]);
		});

		test('should handle multiple errors correctly', async () => {
			class TestService {
				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processUser(userId: string): Promise<string> {
					throw new Error(`Error for ${userId}`);
				}
			}

			const service = new TestService();

			await expect(service.processUser('user1')).rejects.toThrow(
				'Error for user1',
			);
			await expect(service.processUser('user1')).rejects.toThrow(
				'Error for user1',
			);
		});
	});

	describe('Timeout Behavior', () => {
		test('should release lock after timeout', async () => {
			let lockReleased = false;

			class TestService {
				@Lock({ timeout: 100, keyPath: 'userId' })
				async longRunningProcess(userId: string): Promise<string> {
					await new Promise((resolve) => setTimeout(resolve, 200));
					lockReleased = true;
					return `processed-${userId}`;
				}
			}

			const service = new TestService();

			const promise = service.longRunningProcess('user1');

			await new Promise((resolve) => setTimeout(resolve, 150));

			await promise;
			expect(lockReleased).toBe(true);
		}, 500);
	});

	describe('Method Context', () => {
		test('should preserve method context (this)', async () => {
			class TestService {
				private prefix = 'service';

				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processUser(userId: string): Promise<string> {
					return `${this.prefix}-processed-${userId}`;
				}
			}

			const service = new TestService();
			const result = await service.processUser('test-user');
			expect(result).toBe('service-processed-test-user');
		});

		test('should work with different method names', async () => {
			class TestService {
				@Lock({ timeout: 1000, keyPath: 'id' })
				async methodA(id: string): Promise<string> {
					return `methodA-${id}`;
				}

				@Lock({ timeout: 1000, keyPath: 'id' })
				async methodB(id: string): Promise<string> {
					return `methodB-${id}`;
				}
			}

			const service = new TestService();

			const promise1 = service.methodA('test');
			const promise2 = service.methodB('test');

			const [result1, result2] = await Promise.all([promise1, promise2]);

			expect(result1).toBe('methodA-test');
			expect(result2).toBe('methodB-test');
		});
	});

	describe('Lock Provider Configuration', () => {
		test('should work with memory configuration', async () => {
			// Re-register with explicit memory config for this test
			container.clearInstances();
			const memoryConfig: MemoryLockConfig = { type: 'memory' };
			container.register(LockManagerService, {
				useFactory: () => new LockManagerService(memoryConfig),
			});

			class TestService {
				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processUser(userId: string): Promise<string> {
					return `processed-${userId}`;
				}
			}

			const service = new TestService();
			const result = await service.processUser('test-user');
			expect(result).toBe('processed-test-user');

			// Verify configuration
			const lockManager = container.resolve(LockManagerService);
			expect(lockManager.getConfig()).toEqual({ type: 'memory' });
		});

		test('should throw error for NATS configuration (not implemented yet)', async () => {
			// Re-register with NATS config for this test
			container.clearInstances();
			const natsConfig: NatsLockConfig = {
				type: 'nats',
				servers: ['nats://localhost:4222'],
				timeout: 5000,
				reconnect: true,
			};
			container.register(LockManagerService, {
				useFactory: () => new LockManagerService(natsConfig),
			});

			class TestService {
				@Lock({ timeout: 1000, keyPath: 'userId' })
				async processUser(userId: string): Promise<string> {
					return `processed-${userId}`;
				}
			}

			const service = new TestService();
			await expect(service.processUser('test-user')).rejects.toThrow(
				/NATS package not installed|CONNECTION_REFUSED|Failed to connect to NATS/,
			);

			// Verify configuration is properly set
			const lockManager = container.resolve(LockManagerService);
			expect(lockManager.getConfig()).toEqual(natsConfig);
		});

		test('should support NATS configuration with custom options', async () => {
			container.clearInstances();
			const natsConfig: NatsLockConfig = {
				type: 'nats',
				servers: ['nats://localhost:4222', 'nats://backup:4222'],
				timeout: 10000,
				reconnect: true,
				maxReconnectAttempts: 5,
				lockStreamName: 'CUSTOM_LOCKS',
				lockTtlMs: 600000,
			};
			container.register(LockManagerService, {
				useFactory: () => new LockManagerService(natsConfig),
			});

			// Verify configuration is properly set
			const lockManager = container.resolve(LockManagerService);
			expect(lockManager.getConfig()).toEqual(natsConfig);
		});

		test('should support cleanup for external providers', async () => {
			const lockManager = container.resolve(LockManagerService);

			// Should not throw for memory provider (no cleanup needed)
			await expect(lockManager.cleanup()).resolves.toBeUndefined();
		});
	});
});
