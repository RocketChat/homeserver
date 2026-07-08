import { createLogger, fetch, PresenceEDU, ReceiptEDU, TypingEDU } from '@rocket.chat/federation-core';
import { Pdu, PersistentEventBase } from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';

import type { AppServiceEphemeralEvent, CachedAppService } from '../models/appservice.model';
import { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import { AppServiceTransactionRepository } from '../repositories/appservice-txn.repository';
import { eduBatchToAppServiceEphemeral } from '../utils/edu-to-appservice';

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;

@singleton()
export class TransactionSenderService {
	private readonly logger = createLogger('TransactionSenderService');

	// Resolves persisted event bodies by id — needed to rebuild transaction
	// payloads on retry. Injected from federation-sdk since the appservice
	// package doesn't own the event store.
	private eventResolver?: (eventIds: string[]) => Promise<Record<string, unknown>[]>;

	constructor(
		@inject(delay(() => AppServiceStateRepository))
		private readonly stateRepo: AppServiceStateRepository,
		@inject(delay(() => AppServiceTransactionRepository))
		private readonly txnRepo: AppServiceTransactionRepository,
	) {}

	setEventResolver(resolver: (eventIds: string[]) => Promise<Record<string, unknown>[]>): void {
		this.eventResolver = resolver;
	}

	/**
	 * Send a transaction to an appservice.
	 * Queues it first, then attempts delivery. On failure, marks the bridge as DOWN
	 * and schedules retries with exponential backoff.
	 */
	async sendTransaction(
		appservice: CachedAppService,
		events: PersistentEventBase[],
		ephemeral?: (ReceiptEDU | TypingEDU | PresenceEDU)[],
	): Promise<void> {
		const { registration } = appservice;

		if (!registration.url) {
			// A registration without a url is a valid receive-only appservice, but the
			// events here are dropped (never queued), so surface it rather than fail silently.
			this.logger.warn({
				msg: 'Appservice has no URL configured; skipping transaction (receive-only mode)',
				asId: registration._id,
			});
			return;
		}

		const txnId = await this.stateRepo.incrementTxnId(registration._id);

		const eventIds = events.map((e) => e.eventId).filter(Boolean);
		const serializedEvents = events.map((e) => ({ event_id: e.eventId, ...e.event }));

		const ephemeralEvents = ephemeral && ephemeral.length > 0 ? eduBatchToAppServiceEphemeral(ephemeral) : undefined;

		await this.txnRepo.create({
			_id: `${registration._id}:${txnId}`,
			asId: registration._id,
			txnId,
			eventIds,
			...(ephemeralEvents && { ephemeralEvents }),
			status: 'pending',
			attempts: 0,
			createdAt: new Date(),
		});

		await this.attemptDeliveryRaw(appservice, txnId, this.buildBody(serializedEvents, ephemeralEvents));
	}

	/**
	 * Retry all pending/failed transactions for an appservice.
	 */
	async retryPending(appservice: CachedAppService): Promise<void> {
		const pending = await this.txnRepo.getPending(appservice.registration._id);

		const now = new Date();
		const eligible = pending.filter((txn) => {
			const backoffMs = Math.min(INITIAL_BACKOFF_MS * 2 ** txn.attempts, MAX_BACKOFF_MS);
			const nextAttemptAt = new Date((txn.sentAt ?? txn.createdAt).getTime() + backoffMs);
			return now >= nextAttemptAt;
		});

		const resolveEvents = this.eventResolver;
		if (!resolveEvents) {
			this.logger.warn({ msg: 'No event resolver configured; skipping transaction retry', asId: appservice.registration._id });
			return;
		}

		await Promise.all(
			eligible.map(async (txn) => {
				const events = await resolveEvents(txn.eventIds);
				await this.attemptDeliveryRaw(appservice, txn.txnId, this.buildBody(events, txn.ephemeralEvents));
			}),
		);
	}

	private buildBody(events: Record<string, unknown>[], ephemeral?: AppServiceEphemeralEvent[]): Record<string, unknown> {
		const body: Record<string, unknown> = { events };
		if (ephemeral?.length) {
			// Send under both the unstable MSC2409 key (what Synapse emits and most bridges read)
			// and the stable spec key (Matrix v1.13+).
			body['de.sorunome.msc2409.ephemeral'] = ephemeral;
			body.ephemeral = ephemeral;
		}
		return body;
	}

	private async attemptDeliveryRaw(appservice: CachedAppService, txnId: number, body: Record<string, unknown>): Promise<boolean> {
		const { registration } = appservice;

		if (!registration.url) return false;

		const url = new URL(`${registration.url}/_matrix/app/v1/transactions/${txnId}`);

		try {
			const response = await fetch(url, {
				method: 'PUT',
				headers: {
					'Authorization': `Bearer ${registration.hsToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			});

			if (response.ok) {
				await this.txnRepo.markSent(registration._id, txnId);
				await this.stateRepo.markUp(registration._id);
				return true;
			}

			this.logger.warn({
				msg: `Transaction delivery failed`,
				asId: registration._id,
				txnId,
				status: response.status,
			});

			await this.txnRepo.markFailed(registration._id, txnId);
			await this.stateRepo.markDown(registration._id, `HTTP ${response.status}`);
			return false;
		} catch (err) {
			this.logger.error({
				msg: `Transaction delivery error`,
				asId: registration._id,
				txnId,
				err,
			});

			await this.txnRepo.markFailed(registration._id, txnId);
			await this.stateRepo.markDown(registration._id, err instanceof Error ? err.message : 'Unknown error');
			return false;
		}
	}
}
