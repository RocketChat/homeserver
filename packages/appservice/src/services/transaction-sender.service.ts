import { createLogger, fetch, PresenceEDU, ReceiptEDU, TypingEDU } from '@rocket.chat/federation-core';
import { PersistentEventBase } from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';

import { PingService } from './ping.service';
import type { AppServiceEphemeralEvent, CachedAppService } from '../models/appservice.model';
import { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import { AppServiceTransactionRepository } from '../repositories/appservice-txn.repository';
import { eduBatchToAppServiceEphemeral } from '../utils/edu-to-appservice';

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;
const RETRY_POLL_INTERVAL_MS = 15_000;

@singleton()
export class TransactionSenderService {
	private readonly logger = createLogger('TransactionSenderService');

	// Resolves persisted event bodies by id — needed to rebuild transaction
	// payloads on retry. Injected from federation-sdk since the appservice
	// package doesn't own the event store.
	private eventResolver?: (eventIds: string[]) => Promise<Record<string, unknown>[]>;

	private retryTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		@inject(delay(() => AppServiceStateRepository))
		private readonly stateRepo: AppServiceStateRepository,
		@inject(delay(() => AppServiceTransactionRepository))
		private readonly txnRepo: AppServiceTransactionRepository,
		private readonly pingService: PingService,
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

		// If the bridge is down, don't attempt inline delivery — it would land
		// this txn ahead of the queued backlog once the bridge recovers. Leave it
		// pending for the ordered drain in retryPending.
		const state = await this.stateRepo.getState(registration._id);
		if (state?.state === 'down') {
			return;
		}

		await this.attemptDeliveryRaw(appservice, txnId, this.buildBody(serializedEvents, ephemeralEvents));
	}

	/**
	 * Start the background poller that drives retries and bridge-health
	 * recovery. Idempotent — a second call while running is a no-op.
	 */
	startRetryScheduler(getAppServices: () => CachedAppService[], intervalMs: number = RETRY_POLL_INTERVAL_MS): void {
		if (this.retryTimer) {
			return;
		}
		this.retryTimer = setInterval(() => {
			void this.pollAll(getAppServices());
		}, intervalMs);
	}

	stopRetryScheduler(): void {
		if (this.retryTimer) {
			clearInterval(this.retryTimer);
			this.retryTimer = null;
		}
	}

	private async pollAll(appservices: CachedAppService[]): Promise<void> {
		// Appservices are independent, so poll them concurrently; ordering only
		// matters within a single bridge's queue (enforced in retryPending).
		await Promise.all(
			appservices.map((appservice) =>
				this.pollAppService(appservice).catch((err) => {
					this.logger.error({ msg: 'Retry poll failed', asId: appservice.registration._id, err });
				}),
			),
		);
	}

	/**
	 * One poll tick for a single appservice. A bridge marked `down` is probed
	 * with a cheap ping rather than by replaying its queue; only once the ping
	 * confirms connectivity do we drain pending transactions. This avoids
	 * hammering a dead bridge with a burst of failing deliveries each cycle.
	 */
	private async pollAppService(appservice: CachedAppService): Promise<void> {
		const asId = appservice.registration._id;
		const state = await this.stateRepo.getState(asId);

		if (state?.state === 'down') {
			const probe = await this.pingService.ping(asId);
			if ('errcode' in probe) {
				return; // still unreachable — wait for the next tick
			}
			await this.stateRepo.markUp(asId);
		}

		await this.retryPending(appservice);
	}

	/**
	 * Drain an appservice's pending/failed transactions in strict txnId order,
	 * honouring per-transaction exponential backoff. Delivery is serial (never
	 * parallel) so the bridge receives transactions in creation order; the first
	 * not-yet-due or failing transaction stops the drain so later transactions
	 * never overtake an earlier one.
	 */
	async retryPending(appservice: CachedAppService): Promise<void> {
		const resolveEvents = this.eventResolver;
		const pending = await this.txnRepo.getPending(appservice.registration._id);
		const now = new Date();

		for (const txn of pending) {
			const backoffMs = Math.min(INITIAL_BACKOFF_MS * 2 ** txn.attempts, MAX_BACKOFF_MS);
			const nextAttemptAt = new Date((txn.lastAttemptAt ?? txn.createdAt).getTime() + backoffMs);
			if (now < nextAttemptAt) {
				break; // oldest txn isn't due yet; deliver strictly in order
			}

			// Only event-bearing txns need rehydration; ephemeral-only txns
			// (eventIds: []) can be delivered without a resolver.
			let events: Record<string, unknown>[] = [];
			if (txn.eventIds.length > 0) {
				if (!resolveEvents) {
					this.logger.warn({
						msg: 'No event resolver configured; cannot rebuild transaction, stopping drain',
						asId: appservice.registration._id,
						txnId: txn.txnId,
					});
					break; // can't reconstruct in order — stop so later txns don't overtake it
				}
				try {
					// Serial by design: a bridge must receive transactions in txnId order,
					// so we deliver one at a time rather than fanning out with Promise.all.
					// eslint-disable-next-line no-await-in-loop
					events = await resolveEvents(txn.eventIds);
				} catch (err) {
					// Payload couldn't be fully rebuilt (e.g. a referenced event is gone).
					// Record the failed attempt so backoff advances, and stop the drain so
					// later txns don't overtake this one. Never deliver a partial payload.
					this.logger.error({
						msg: 'Failed to rebuild transaction payload for retry',
						asId: appservice.registration._id,
						txnId: txn.txnId,
						err,
					});
					// eslint-disable-next-line no-await-in-loop
					await this.txnRepo.markFailed(appservice.registration._id, txn.txnId);
					break;
				}
			}

			// eslint-disable-next-line no-await-in-loop
			const delivered = await this.attemptDeliveryRaw(appservice, txn.txnId, this.buildBody(events, txn.ephemeralEvents));
			if (!delivered) {
				break; // attemptDeliveryRaw marked the bridge down; stop so ordering holds
			}
		}
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
