import { container, injectable } from 'tsyringe';

export type MemoryLockConfig = {
	type: 'memory';
};

export type NatsLockConfig = {
	type: 'nats';
	servers: string[];
	timeout?: number;
	reconnect?: boolean;
	maxReconnectAttempts?: number;
	lockStreamName?: string;
	lockTtlMs?: number;
};

export type ExternalLockConfig = NatsLockConfig;

export type LockConfig = MemoryLockConfig | ExternalLockConfig;

export interface ILockProvider {
	acquireLock(key: string, timeoutMs: number): Promise<() => void>;
	cleanup?(): Promise<void>;
}

class InMemoryLockProvider implements ILockProvider {
	private static instance: InMemoryLockProvider;
	private locks = new Map<string, Promise<void>>();

	static getInstance(): InMemoryLockProvider {
		if (!InMemoryLockProvider.instance) {
			InMemoryLockProvider.instance = new InMemoryLockProvider();
		}
		return InMemoryLockProvider.instance;
	}

	async acquireLock(key: string, timeoutMs: number): Promise<() => void> {
		while (this.locks.has(key)) {
			try {
				await this.locks.get(key);
			} catch {}
		}

		let releaseFn: (value?: any) => void;

		const lockPromise = new Promise<void>((resolve) => {
			releaseFn = resolve;
		});

		this.locks.set(key, lockPromise);

		const timeoutHandle = setTimeout(() => {
			this.locks.delete(key);
			releaseFn();
		}, timeoutMs);

		return () => {
			clearTimeout(timeoutHandle);
			this.locks.delete(key);
			releaseFn();
		};
	}
}

// NATS types (these would come from 'nats' package in real implementation)
type NatsConnection = any;
type JetStreamManager = any;
type JetStream = any;

class NatsLockProvider implements ILockProvider {
	private connection: NatsConnection | null = null;
	private jsm: JetStreamManager | null = null;
	private js: JetStream | null = null;
	private config: NatsLockConfig;
	private readonly streamName: string;
	private readonly lockPrefix = 'lock.';

	constructor(config: NatsLockConfig) {
		this.config = config;
		this.streamName = config.lockStreamName || 'LOCKS';
	}

	private async ensureConnection(): Promise<void> {
		if (this.connection && !this.connection.isClosed()) {
			return;
		}

		try {
			// Dynamic import to handle optional NATS dependency
			const { connect } = await import('nats').catch(() => {
				throw new Error('NATS package not installed. Run: bun add nats');
			});

			this.connection = await connect({
				servers: this.config.servers,
				timeout: this.config.timeout || 5000,
				reconnect: this.config.reconnect !== false,
				maxReconnectAttempts: this.config.maxReconnectAttempts || 10,
			});

			this.js = this.connection.jetstream();
			this.jsm = await this.js.jetstreamManager();

			await this.ensureStream();
		} catch (error) {
			throw new Error(`Failed to connect to NATS: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async ensureStream(): Promise<void> {
		if (!this.jsm) {
			throw new Error('JetStream manager not initialized');
		}

		try {
			await this.jsm.streams.info(this.streamName);
		} catch {
			await this.jsm.streams.add({
				name: this.streamName,
				subjects: [`${this.lockPrefix}*`],
				retention: 'workqueue' as any,
				max_age: (this.config.lockTtlMs || 300000) * 1_000_000, // Convert ms to nanoseconds
				max_msgs: 10000,
				discard: 'old' as any,
			});
		}
	}

	async acquireLock(key: string, timeoutMs: number): Promise<() => void> {
		await this.ensureConnection();

		if (!this.connection || !this.jsm || !this.js) {
			throw new Error('NATS connection not established');
		}

		const lockSubject = `${this.lockPrefix}${key}`;
		const consumerName = `lock-${key}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		try {
			// Publish lock acquisition message
			const lockPayload = JSON.stringify({
				owner: `${process.pid}-${Date.now()}`,
				acquired_at: new Date().toISOString(),
				timeout_ms: timeoutMs,
			});

			await this.js.publish(lockSubject, new TextEncoder().encode(lockPayload));

			// Create consumer to try to get the lock message
			const consumer = await this.js.consumers.get(this.streamName, {
				name: consumerName,
				filter_subject: lockSubject,
				deliver_policy: 'new' as any,
				ack_policy: 'explicit' as any,
				max_deliver: 1,
				inactive_threshold: timeoutMs * 1_000_000,
			});

			// Try to consume our message
			const messages = await consumer.consume({ max_messages: 1 });

			let lockAcquired = false;
			let messageToAck: any = null;

			for await (const message of messages) {
				lockAcquired = true;
				messageToAck = message;
				break;
			}

			if (!lockAcquired) {
				await this.waitForLockRelease(lockSubject, timeoutMs);
				return this.acquireLock(key, timeoutMs);
			}

			// Set up automatic release
			const timeoutHandle = setTimeout(async () => {
				if (messageToAck) {
					messageToAck.ack();
				}
				await this.cleanupConsumer(consumerName);
			}, timeoutMs);

			return async () => {
				clearTimeout(timeoutHandle);
				if (messageToAck) {
					messageToAck.ack();
				}
				await this.cleanupConsumer(consumerName);
			};
		} catch (error) {
			await this.cleanupConsumer(consumerName);
			throw new Error(`Failed to acquire lock for key "${key}": ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async waitForLockRelease(lockSubject: string, timeoutMs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Timeout waiting for lock release: ${lockSubject}`));
			}, timeoutMs);

			// Simple backoff strategy - in production you might want more sophisticated monitoring
			setTimeout(
				() => {
					clearTimeout(timeout);
					resolve();
				},
				Math.min(100, timeoutMs / 10),
			);
		});
	}

	private async cleanupConsumer(consumerName: string): Promise<void> {
		try {
			if (this.jsm) {
				await this.jsm.consumers.delete(this.streamName, consumerName);
			}
		} catch {
			// Ignore cleanup errors
		}
	}

	async cleanup(): Promise<void> {
		if (this.connection && !this.connection.isClosed()) {
			await this.connection.close();
			this.connection = null;
			this.jsm = null;
			this.js = null;
		}
	}
}

class LockProviderFactory {
	static create(config: LockConfig): ILockProvider {
		switch (config.type) {
			case 'memory':
				return InMemoryLockProvider.getInstance();

			case 'nats':
				return new NatsLockProvider(config);

			default:
				throw new Error(`Unsupported lock provider type: ${JSON.stringify(config)}`);
		}
	}
}

@injectable()
export class LockManagerService {
	private provider: ILockProvider;
	private config: LockConfig;

	constructor(config: LockConfig = { type: 'memory' }) {
		this.config = config;
		this.provider = LockProviderFactory.create(config);
	}

	async acquireLock(key: string, timeoutMs: number): Promise<() => void> {
		return this.provider.acquireLock(key, timeoutMs);
	}

	getConfig(): LockConfig {
		return { ...this.config };
	}

	async cleanup(): Promise<void> {
		if (this.provider.cleanup) {
			await this.provider.cleanup();
		}
	}
}

function getLockManagerService(): LockManagerService {
	try {
		return container.resolve(LockManagerService);
	} catch (error) {
		throw new Error('LockManagerService not registered. Make sure to register it as a singleton in your DI container.');
	}
}

export interface LockOptions {
	timeout: number;
	keyPath: string;
}

/**
 * Locking decorator that provides mutual exclusion based on a key extracted from function parameters
 *
 * @param options Configuration for the lock including timeout and key extraction path
 *
 * @example
 * ```typescript
 * class UserService {
 *   @Lock({ timeout: 5000, keyPath: 'userId' })
 *   async updateUser(userId: string, data: any) {
 *     // This method will be locked per userId
 *   }
 *
 *   @Lock({ timeout: 10000, keyPath: 'request.roomId' })
 *   async joinRoom(request: { roomId: string, userId: string }) {
 *     // This method will be locked per roomId
 *   }
 * }
 * ```
 */
export function Lock(options: LockOptions) {
	return <T extends (...args: any[]) => Promise<any>>(_target: any, propertyName: string, descriptor: TypedPropertyDescriptor<T>) => {
		const originalMethod = descriptor.value;

		if (!originalMethod) {
			throw new Error('Lock decorator can only be applied to methods');
		}

		descriptor.value = async function (this: any, ...args: any[]) {
			const lockKey = extractLockKey(args, options.keyPath, propertyName);

			const lockManagerService = getLockManagerService();

			const releaseLock = await lockManagerService.acquireLock(lockKey, options.timeout);

			try {
				return await originalMethod.apply(this, args);
			} finally {
				releaseLock();
			}
		} as T;

		return descriptor;
	};
}

function extractLockKey(args: any[], keyPath: string, methodName: string): string {
	try {
		const pathParts = keyPath.split('.');

		if (pathParts.length === 1) {
			const paramName = pathParts[0];

			if (args.length > 0) {
				if (typeof args[0] === 'string' || typeof args[0] === 'number') {
					if (['userId', 'id', 'roomId', 'eventId', 'fileId', 'tableId'].includes(paramName)) {
						return `${methodName}:${String(args[0])}`;
					}
				}

				if (typeof args[0] === 'object' && args[0] !== null && paramName in args[0]) {
					const value = args[0][paramName];
					if (value !== undefined && value !== null) {
						return `${methodName}:${String(value)}`;
					}
				}
			}

			throw new Error(`Could not find parameter '${paramName}' in method arguments`);
		}

		let current = args[0];
		for (const part of pathParts) {
			if (current === null || current === undefined) {
				throw new Error(`Path '${keyPath}' leads to null/undefined value`);
			}
			if (typeof current !== 'object') {
				throw new Error(`Path '${keyPath}' expects object but found ${typeof current}`);
			}
			current = current[part];
		}

		if (current === undefined || current === null) {
			throw new Error(`Could not extract lock key from path '${keyPath}'`);
		}

		return `${methodName}:${String(current)}`;
	} catch (error) {
		throw new Error(`Failed to extract lock key from path '${keyPath}': ${error instanceof Error ? error.message : String(error)}`);
	}
}
