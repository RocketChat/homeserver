import { createLogger, fetch, PresenceEDU, ReceiptEDU, TypingEDU } from '@rocket.chat/federation-core';
import { PersistentEventBase } from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';

import type { AppServiceEphemeralEvent, CachedAppService } from '../models/appservice.model';
import { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import { AppServiceTransactionRepository } from '../repositories/appservice-txn.repository';
import { eduBatchToAppServiceEphemeral } from '../utils/edu-to-appservice';

// Backoff doubles per consecutive failure: 2^1 = 2s up to 2^9 = 512s (matches Synapse).
const MAX_BACKOFF_EXPONENT = 9;

interface Recoverer {
	appservice: CachedAppService;
	backoffCounter: number;
	timer: ReturnType<typeof setTimeout> | null;
	retrying: boolean;
}

@singleton()
export class TransactionSenderService {
	private readonly logger = createLogger('TransactionSenderService');

	// Resolves persisted event bodies by id — needed to rebuild transaction
	// payloads on retry. Injected from federation-sdk since the appservice
	// package doesn't own the event store.
	private eventResolver?: (eventIds: string[]) => Promise<Record<string, unknown>[]>;

	private readonly recoverers = new Map<string, Recoverer>();

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
	 * Send a transaction to an appservice. The transaction is persisted before
	 * any delivery attempt; while the bridge is up it is pushed inline and the
	 * row deleted on success. The first failed push marks the bridge DOWN and
	 * starts a recoverer that drains the backlog with exponential backoff.
	 * While DOWN, transactions are only persisted — never pushed — so the
	 * recoverer delivers them strictly in txnId order.
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

		const isUp = (await this.stateRepo.getState(registration._id))?.state !== 'down';

		// Ephemeral events are never persisted, so an ephemeral-only batch for a
		// down bridge has nothing to queue — drop it without creating a txn.
		if (!isUp && events.length === 0) {
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
			createdAt: new Date(),
		});

		if (!isUp) {
			return;
		}

		const sent = await this.putTransaction(appservice, txnId, this.buildBody(serializedEvents, ephemeralEvents));
		if (sent) {
			await this.txnRepo.complete(registration._id, txnId);
			return;
		}

		// The row stays as the head of the backlog; its ephemeral riders are lost.
		await this.startRecoverer(appservice, `Failed to deliver transaction ${txnId}`);
	}

	/**
	 * MSC2659 fast path: a successful appservice-initiated ping cancels the
	 * recoverer's backoff and drains the backlog immediately. No-op when the
	 * bridge is up (no recoverer exists).
	 */
	async forceRetry(asId: string): Promise<void> {
		const recoverer = this.recoverers.get(asId);
		if (!recoverer) {
			return;
		}

		if (recoverer.timer) {
			clearTimeout(recoverer.timer);
			recoverer.timer = null;
		}
		recoverer.backoffCounter = 1;

		await this.retry(recoverer);
	}

	/**
	 * Boot path: resume recovery for bridges persisted as DOWN. Bridges
	 * persisted as UP are left alone (matches Synapse).
	 */
	async startRecoverersForDownServices(appservices: CachedAppService[]): Promise<void> {
		for (const appservice of appservices) {
			const asId = appservice.registration._id;
			if (this.recoverers.has(asId)) {
				continue;
			}

			// eslint-disable-next-line no-await-in-loop
			const state = await this.stateRepo.getState(asId);
			if (state?.state !== 'down') {
				continue;
			}

			this.logger.info({ msg: 'Appservice persisted as down; resuming recoverer', asId });
			this.scheduleRetry(this.createRecoverer(appservice));
		}
	}

	private async startRecoverer(appservice: CachedAppService, error: string): Promise<void> {
		const asId = appservice.registration._id;
		if (this.recoverers.has(asId)) {
			return;
		}

		await this.stateRepo.markDown(asId, error);
		this.logger.warn({ msg: 'Appservice marked down; starting recoverer', asId, error });
		this.scheduleRetry(this.createRecoverer(appservice));
	}

	private createRecoverer(appservice: CachedAppService): Recoverer {
		const recoverer: Recoverer = { appservice, backoffCounter: 1, timer: null, retrying: false };
		this.recoverers.set(appservice.registration._id, recoverer);
		return recoverer;
	}

	private scheduleRetry(recoverer: Recoverer): void {
		const delayMs = 2 ** recoverer.backoffCounter * 1000;
		recoverer.timer = setTimeout(() => {
			recoverer.timer = null;
			void this.retry(recoverer).catch((err) => {
				this.logger.error({ msg: 'Recoverer retry failed', asId: recoverer.appservice.registration._id, err });
			});
		}, delayMs);
		// Don't let a pending retry by itself keep the process (or a test runner) alive.
		recoverer.timer.unref?.();
	}

	/**
	 * Drain the backlog oldest-first, one transaction in flight. Each success
	 * deletes the row and resets the backoff; a failure reschedules with the
	 * next backoff step. Only when the queue is empty is the bridge marked UP
	 * and the recoverer removed — live delivery then resumes.
	 */
	private async retry(recoverer: Recoverer): Promise<void> {
		if (recoverer.retrying) {
			return;
		}
		recoverer.retrying = true;

		const asId = recoverer.appservice.registration._id;

		try {
			for (;;) {
				// eslint-disable-next-line no-await-in-loop
				const txn = await this.txnRepo.getOldestPending(asId);
				if (!txn) {
					this.recoverers.delete(asId);
					// eslint-disable-next-line no-await-in-loop
					await this.stateRepo.markUp(asId);
					this.logger.info({ msg: 'Appservice backlog drained; marked up', asId });
					return;
				}

				let events: Record<string, unknown>[] = [];
				if (txn.eventIds.length > 0) {
					const resolveEvents = this.eventResolver;
					if (!resolveEvents) {
						this.logger.warn({
							msg: 'No event resolver configured; cannot rebuild transaction, rescheduling',
							asId,
							txnId: txn.txnId,
						});
						this.backoffAndReschedule(recoverer);
						return;
					}
					try {
						// eslint-disable-next-line no-await-in-loop
						events = await resolveEvents(txn.eventIds);
					} catch (err) {
						// Payload couldn't be fully rebuilt (e.g. a referenced event is gone).
						// Keep the row and back off — never deliver a partial payload, never
						// delete an undelivered transaction.
						this.logger.error({ msg: 'Failed to rebuild transaction payload for retry', asId, txnId: txn.txnId, err });
						this.backoffAndReschedule(recoverer);
						return;
					}
				}

				// eslint-disable-next-line no-await-in-loop
				const sent = await this.putTransaction(recoverer.appservice, txn.txnId, this.buildBody(events));
				if (!sent) {
					this.backoffAndReschedule(recoverer);
					return;
				}

				// eslint-disable-next-line no-await-in-loop
				await this.txnRepo.complete(asId, txn.txnId);
				recoverer.backoffCounter = 1;
			}
		} finally {
			recoverer.retrying = false;
		}
	}

	private backoffAndReschedule(recoverer: Recoverer): void {
		if (recoverer.backoffCounter < MAX_BACKOFF_EXPONENT) {
			recoverer.backoffCounter++;
		}
		this.scheduleRetry(recoverer);
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

	private async putTransaction(appservice: CachedAppService, txnId: number, body: Record<string, unknown>): Promise<boolean> {
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
				return true;
			}

			this.logger.warn({
				msg: `Transaction delivery failed`,
				asId: registration._id,
				txnId,
				status: response.status,
			});
			return false;
		} catch (err) {
			this.logger.error({
				msg: `Transaction delivery error`,
				asId: registration._id,
				txnId,
				err,
			});
			return false;
		}
	}
}
