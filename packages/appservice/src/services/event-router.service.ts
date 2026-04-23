import { createLogger, type EventHandlerOf, type HomeserverEventSignatures } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import { NamespaceMatcherService } from './namespace-matcher.service';
import { TransactionSenderService } from './transaction-sender.service';
import type { CachedAppService } from '../models/appservice.model';

interface EventBatch {
	events: Record<string, unknown>[];
	ephemeral: Record<string, unknown>[];
	timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_BATCH_WINDOW_MS = 100;
const MAX_BATCH_SIZE = 50;

@singleton()
export class EventRouterService {
	private readonly logger = createLogger('EventRouterService');

	private batches: Map<string, EventBatch> = new Map();

	private batchWindowMs = DEFAULT_BATCH_WINDOW_MS;

	// Callback to resolve room aliases and members for interest detection
	private roomAliasResolver?: (roomId: string) => Promise<string[]>;

	private roomMemberResolver?: (roomId: string) => Promise<string[]>;

	constructor(private readonly namespaceMatcher: NamespaceMatcherService, private readonly transactionSender: TransactionSenderService) {}

	/**
	 * Set resolvers for room aliases and members. These are injected from the
	 * homeserver layer since the appservice package doesn't own room state.
	 */
	setResolvers(aliasResolver: (roomId: string) => Promise<string[]>, memberResolver: (roomId: string) => Promise<string[]>): void {
		this.roomAliasResolver = aliasResolver;
		this.roomMemberResolver = memberResolver;
	}

	setBatchWindowMs(ms: number): void {
		this.batchWindowMs = ms;
	}

	/**
	 * Subscribe to all relevant events from the EventEmitterService.
	 */
	subscribe(emitter: {
		on<K extends keyof HomeserverEventSignatures>(
			event: K,
			handler: EventHandlerOf<HomeserverEventSignatures, K>,
		): (() => void) | undefined;
	}): void {
		// Persistent events
		const persistentEvents: (keyof HomeserverEventSignatures)[] = [
			'homeserver.matrix.message',
			'homeserver.matrix.membership',
			'homeserver.matrix.room.create',
			'homeserver.matrix.reaction',
			'homeserver.matrix.redaction',
			'homeserver.matrix.room.name',
			'homeserver.matrix.room.topic',
			'homeserver.matrix.room.power_levels',
			'homeserver.matrix.room.server_acl',
			'homeserver.matrix.encryption',
			'homeserver.matrix.encrypted',
		];

		for (const eventName of persistentEvents) {
			emitter.on(eventName, (async (data: any) => {
				await this.routeEvent(data.event, false);
			}) as any);
		}

		// Ephemeral events
		const ephemeralEvents: (keyof HomeserverEventSignatures)[] = [
			'homeserver.matrix.typing',
			'homeserver.matrix.presence',
			'homeserver.matrix.receipt',
		];

		for (const eventName of ephemeralEvents) {
			emitter.on(eventName, (async (data: any) => {
				await this.routeEphemeralEvent(data);
			}) as any);
		}

		this.logger.info({ msg: 'EventRouter subscribed to homeserver events' });
	}

	private async routeEvent(event: Record<string, unknown>, isEphemeral: boolean): Promise<void> {
		const roomId = event.room_id as string;
		const sender = event.sender as string;

		if (!roomId || !sender) return;

		const [aliases, members] = await Promise.all([this.roomAliasResolver?.(roomId) ?? [], this.roomMemberResolver?.(roomId) ?? []]);

		const interested = this.namespaceMatcher.getInterestedAppServices(roomId, sender, aliases, members);

		for (const as of interested) {
			if (isEphemeral && !as.registration.receiveEphemeral) continue;
			this.addToBatch(as, event, isEphemeral);
		}
	}

	private async routeEphemeralEvent(data: Record<string, unknown>): Promise<void> {
		// Build a minimal event-like object from EDU data
		const event = { ...data };
		const roomId = (data.room_id as string) || '';
		const sender = (data.user_id as string) || '';

		const [aliases, members] = await Promise.all([
			roomId ? this.roomAliasResolver?.(roomId) ?? [] : [],
			roomId ? this.roomMemberResolver?.(roomId) ?? [] : [],
		]);

		const interested = this.namespaceMatcher.getInterestedAppServices(roomId, sender, aliases, members);

		for (const as of interested) {
			if (!as.registration.receiveEphemeral) continue;
			this.addToBatch(as, event, true);
		}
	}

	private addToBatch(appservice: CachedAppService, event: Record<string, unknown>, isEphemeral: boolean): void {
		const asId = appservice.registration._id;
		let batch = this.batches.get(asId);

		if (!batch) {
			batch = { events: [], ephemeral: [], timer: null };
			this.batches.set(asId, batch);
		}

		if (isEphemeral) {
			batch.ephemeral.push(event);
		} else {
			batch.events.push(event);
		}

		const totalSize = batch.events.length + batch.ephemeral.length;

		// Flush immediately if batch is full
		if (totalSize >= MAX_BATCH_SIZE) {
			this.flushBatch(appservice);
			return;
		}

		// Set up timer for batch window
		if (!batch.timer) {
			batch.timer = setTimeout(() => {
				this.flushBatch(appservice);
			}, this.batchWindowMs);
		}
	}

	private flushBatch(appservice: CachedAppService): void {
		const asId = appservice.registration._id;
		const batch = this.batches.get(asId);
		if (!batch) return;

		if (batch.timer) {
			clearTimeout(batch.timer);
		}
		this.batches.delete(asId);

		if (batch.events.length === 0 && batch.ephemeral.length === 0) return;

		this.transactionSender
			.sendTransaction(appservice, batch.events, batch.ephemeral.length > 0 ? batch.ephemeral : undefined)
			.catch((err) => {
				this.logger.error({ msg: 'Failed to send transaction batch', asId, err });
			});
	}
}
