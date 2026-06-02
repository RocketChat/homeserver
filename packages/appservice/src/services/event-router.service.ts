import { createLogger, PresenceEDU, ReceiptEDU, TypingEDU } from '@rocket.chat/federation-core';
import type { PersistentEventBase } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { NamespaceMatcherService } from './namespace-matcher.service';
import { TransactionSenderService } from './transaction-sender.service';
import type { CachedAppService } from '../models/appservice.model';

interface EventBatch {
	events: PersistentEventBase[];
	ephemeral: (ReceiptEDU | TypingEDU | PresenceEDU)[];
	timer: ReturnType<typeof setTimeout> | null;
}

const BATCH_WINDOW_MS = 100;
const MAX_BATCH_SIZE = 50;

@singleton()
export class EventRouterService {
	private readonly logger = createLogger('EventRouterService');

	private batches: Map<string, EventBatch> = new Map();

	// Resolves the aliases and joined members of a room — needed for namespace
	// interest detection. Injected from federation-sdk since the appservice
	// package doesn't own room state.
	private roomStateResolver?: (roomId: string) => Promise<{ aliases: string[]; members: string[] }>;

	constructor(private readonly namespaceMatcher: NamespaceMatcherService, private readonly transactionSender: TransactionSenderService) {}

	setRoomStateResolver(resolver: (roomId: string) => Promise<{ aliases: string[]; members: string[] }>): void {
		this.roomStateResolver = resolver;
	}

	async routeEvent(event: PersistentEventBase): Promise<void> {
		// check if event is persistent or ephemeral based on event type and route accordingly
		await this.routePersistent(event);
	}

	private async routePersistent(event: PersistentEventBase): Promise<void> {
		const { roomId, sender } = event;
		if (!roomId || !sender) {
			return;
		}

		const { aliases, members } = (await this.roomStateResolver?.(roomId)) ?? { aliases: [], members: [] };

		const interested = this.namespaceMatcher.getInterestedAppServices(roomId, sender, aliases, members);

		for (const as of interested) {
			const batch = this.getOrCreateBatch(as);
			batch.events.push(event);
			this.afterAppend(as, batch);
		}
	}

	async routeEphemeral(payload: ReceiptEDU | TypingEDU | PresenceEDU): Promise<void> {
		const targets = this.extractEphemeralTargets(payload);
		const interested = await this.findInterestedForTargets(targets);

		for (const as of interested) {
			if (!as.registration.receiveEphemeral) {
				continue;
			}
			const batch = this.getOrCreateBatch(as);
			batch.ephemeral.push(payload);
			this.afterAppend(as, batch);
		}
	}

	// Returns the (roomId, userId) pairs that should be checked against
	// appservice namespaces for a given EDU. Each EDU shape exposes its
	// room/user references differently — presence has no rooms, receipts can
	// span many rooms and many users.
	private extractEphemeralTargets(payload: ReceiptEDU | TypingEDU | PresenceEDU): Array<{ roomId: string; userId: string }> {
		if (payload.edu_type === 'm.typing') {
			return [{ roomId: payload.content.room_id, userId: payload.content.user_id }];
		}

		if (payload.edu_type === 'm.presence') {
			return payload.content.push.map((update) => ({ roomId: '', userId: update.user_id }));
		}

		const targets: Array<{ roomId: string; userId: string }> = [];
		for (const [roomId, readByUser] of Object.entries(payload.content)) {
			const userIds = Object.keys(readByUser?.['m.read'] ?? {});
			if (userIds.length === 0) {
				targets.push({ roomId, userId: '' });
				continue;
			}
			for (const userId of userIds) {
				targets.push({ roomId, userId });
			}
		}
		return targets;
	}

	private async findInterestedForTargets(targets: Array<{ roomId: string; userId: string }>): Promise<CachedAppService[]> {
		const emptyState = { aliases: [] as string[], members: [] as string[] };
		const uniqueRoomIds = Array.from(new Set(targets.map((t) => t.roomId).filter(Boolean)));

		const resolved = await Promise.all(
			uniqueRoomIds.map(async (roomId) => [roomId, (await this.roomStateResolver?.(roomId)) ?? emptyState] as const),
		);
		const stateByRoom = new Map(resolved);

		const interested = new Map<string, CachedAppService>();
		for (const { roomId, userId } of targets) {
			const state = roomId ? stateByRoom.get(roomId) ?? emptyState : emptyState;
			for (const as of this.namespaceMatcher.getInterestedAppServices(roomId, userId, state.aliases, state.members)) {
				interested.set(as.registration._id, as);
			}
		}

		return Array.from(interested.values());
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
