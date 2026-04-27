import { createLogger, type EventHandlerOf, type HomeserverEventSignatures } from '@rocket.chat/federation-core';
import type { Pdu } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { NamespaceMatcherService } from './namespace-matcher.service';
import { TransactionSenderService } from './transaction-sender.service';
import type { CachedAppService } from '../models/appservice.model';

const PERSISTENT_EVENT_NAMES = [
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
] as const satisfies readonly (keyof HomeserverEventSignatures)[];

const EPHEMERAL_EVENT_NAMES = [
	'homeserver.matrix.typing',
	'homeserver.matrix.presence',
	'homeserver.matrix.receipt',
] as const satisfies readonly (keyof HomeserverEventSignatures)[];

type PersistentEventName = (typeof PERSISTENT_EVENT_NAMES)[number];
type EphemeralEventName = (typeof EPHEMERAL_EVENT_NAMES)[number];
type PersistentEventPayload = HomeserverEventSignatures[PersistentEventName];
type EphemeralEventPayload = HomeserverEventSignatures[EphemeralEventName];

interface EventBatch {
	events: Pdu[];
	ephemeral: EphemeralEventPayload[];
	timer: ReturnType<typeof setTimeout> | null;
}

const BATCH_WINDOW_MS = 100;
const MAX_BATCH_SIZE = 50;

@singleton()
export class EventRouterService {
	private readonly logger = createLogger('EventRouterService');

	private batches: Map<string, EventBatch> = new Map();

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

	/**
	 * Subscribe to all relevant events from the EventEmitterService.
	 */
	subscribe(emitter: {
		on<K extends keyof HomeserverEventSignatures>(
			event: K,
			handler: EventHandlerOf<HomeserverEventSignatures, K>,
		): (() => void) | undefined;
	}): void {
		for (const name of PERSISTENT_EVENT_NAMES) {
			emitter.on(name, async (data: PersistentEventPayload) => {
				await this.routePersistent(data.event);
			});
		}

		for (const name of EPHEMERAL_EVENT_NAMES) {
			emitter.on(name, async (data: EphemeralEventPayload) => {
				await this.routeEphemeral(data);
			});
		}

		this.logger.info({ msg: 'EventRouter subscribed to homeserver events' });
	}

	private async routePersistent(event: Pdu): Promise<void> {
		const { room_id: roomId, sender } = event;
		if (!roomId || !sender) return;

		const [aliases, members] = await Promise.all([this.roomAliasResolver?.(roomId) ?? [], this.roomMemberResolver?.(roomId) ?? []]);

		const interested = this.namespaceMatcher.getInterestedAppServices(roomId, sender, aliases, members);

		for (const as of interested) {
			const batch = this.getOrCreateBatch(as);
			batch.events.push(event);
			this.afterAppend(as, batch);
		}
	}

	private async routeEphemeral(payload: EphemeralEventPayload): Promise<void> {
		const roomId = 'room_id' in payload ? payload.room_id : '';
		const sender = payload.user_id;

		const [aliases, members] = await Promise.all([
			roomId ? this.roomAliasResolver?.(roomId) ?? [] : [],
			roomId ? this.roomMemberResolver?.(roomId) ?? [] : [],
		]);

		const interested = this.namespaceMatcher.getInterestedAppServices(roomId, sender, aliases, members);

		for (const as of interested) {
			if (!as.registration.receiveEphemeral) continue;
			const batch = this.getOrCreateBatch(as);
			batch.ephemeral.push(payload);
			this.afterAppend(as, batch);
		}
	}

	private getOrCreateBatch(appservice: CachedAppService): EventBatch {
		const asId = appservice.registration._id;
		let batch = this.batches.get(asId);
		if (!batch) {
			batch = { events: [], ephemeral: [], timer: null };
			this.batches.set(asId, batch);
		}
		return batch;
	}

	private afterAppend(appservice: CachedAppService, batch: EventBatch): void {
		if (batch.events.length + batch.ephemeral.length >= MAX_BATCH_SIZE) {
			this.flushBatch(appservice);
			return;
		}
		if (!batch.timer) {
			batch.timer = setTimeout(() => {
				this.flushBatch(appservice);
			}, BATCH_WINDOW_MS);
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
