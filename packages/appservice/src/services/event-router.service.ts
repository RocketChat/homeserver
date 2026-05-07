import { createLogger, type HomeserverEventSignatures } from '@rocket.chat/federation-core';
import type { PersistentEventBase } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { NamespaceMatcherService } from './namespace-matcher.service';
import { TransactionSenderService } from './transaction-sender.service';
import type { CachedAppService } from '../models/appservice.model';

const EPHEMERAL_EVENT_NAMES = [
	'homeserver.matrix.typing',
	'homeserver.matrix.presence',
	'homeserver.matrix.receipt',
] as const satisfies readonly (keyof HomeserverEventSignatures)[];

type EphemeralEventName = (typeof EPHEMERAL_EVENT_NAMES)[number];
type EphemeralEventPayload = HomeserverEventSignatures[EphemeralEventName];

interface EventBatch {
	events: PersistentEventBase[];
	ephemeral: EphemeralEventPayload[];
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
		if (!roomId || !sender) return;

		const { aliases, members } = (await this.roomStateResolver?.(roomId)) ?? { aliases: [], members: [] };

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

		const { aliases, members } = roomId
			? (await this.roomStateResolver?.(roomId)) ?? { aliases: [], members: [] }
			: { aliases: [], members: [] };

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
