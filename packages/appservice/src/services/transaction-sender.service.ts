import { createLogger, fetch, PresenceEDU, ReceiptEDU, TypingEDU } from '@rocket.chat/federation-core';
import { PersistentEventBase } from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';

import { RegistrationService } from './registration.service';
import type { AppServiceEphemeralEvent, CachedAppService } from '../models/appservice.model';
import { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import { AppServiceTransactionRepository } from '../repositories/appservice-txn.repository';
import { eduBatchToAppServiceEphemeral } from '../utils/edu-to-appservice';

// Backoff doubles per consecutive failure: 2^1 = 2s up to 2^9 = 512s (matches Synapse).
const MAX_BACKOFF_EXPONENT = 9;

// Holds only the asId — the registration is resolved fresh from
// RegistrationService on every retry so a config change (new URL/token)
// applies to the backlog and a removed bridge stops being retried.
interface Recoverer {
	asId: string;
	backoffCounter: number;
	timer: ReturnType<typeof setTimeout> | null;
	retrying: boolean;
}

// Failure reason feeds the persisted lastError so operators see the actual
// cause (HTTP status / transport error), not a generic delivery message.
type PutResult = { sent: true } | { sent: false; reason: string };

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
		private readonly registrationService: RegistrationService,
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
		// Still adopt: ephemeral traffic can rescue a backlog with no live recoverer.
		if (!isUp && events.length === 0) {
			this.ensureRecoverer(registration._id);
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
			// Adoption must happen after the row is persisted — it pairs with the
			// recoverer's post-markUp re-check to close the empty-queue/markUp race.
			this.ensureRecoverer(registration._id);
			return;
		}

		const result = await this.putTransaction(appservice, txnId, this.buildBody(serializedEvents, ephemeralEvents));
		if (result.sent) {
			await this.txnRepo.complete(registration._id, txnId);
			return;
		}

		// The row stays as the head of the backlog; its ephemeral riders are lost.
		await this.startRecoverer(registration._id, `Failed to deliver transaction ${txnId}: ${result.reason}`);
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
			this.ensureRecoverer(asId);
		}
	}

	private async startRecoverer(asId: string, error: string): Promise<void> {
		if (this.recoverers.has(asId)) {
			return;
		}

		await this.stateRepo.markDown(asId, error);
		this.logger.warn({ msg: 'Appservice marked down; starting recoverer', asId, error });
		this.ensureRecoverer(asId);
	}

	private createRecoverer(asId: string): Recoverer {
		const recoverer: Recoverer = { asId, backoffCounter: 1, timer: null, retrying: false };
		this.recoverers.set(asId, recoverer);
		return recoverer;
	}

	/**
	 * The single creation gate for recoverers: the has()+create pair is
	 * synchronous, so no interleaved path can ever install a second recoverer
	 * (and second timer) for the same bridge on this instance. Any path that
	 * awaits before starting recovery (markDown, getState) must funnel through
	 * here rather than creating directly.
	 *
	 * Also serves adoption: a DOWN bridge with no local recoverer — the
	 * instance that marked it down may be gone (multi-instance) or its
	 * recoverer died. Two instances draining concurrently is safe: txn
	 * delivery is idempotent by txnId and complete/markUp are idempotent.
	 */
	private ensureRecoverer(asId: string): void {
		if (this.recoverers.has(asId)) {
			return;
		}
		this.logger.info({ msg: 'Recoverer scheduled', asId });
		this.scheduleRetry(this.createRecoverer(asId));
	}

	private scheduleRetry(recoverer: Recoverer): void {
		const delayMs = 2 ** recoverer.backoffCounter * 1000;
		recoverer.timer = setTimeout(() => {
			recoverer.timer = null;
			void this.retry(recoverer).catch((err) => {
				this.logger.error({ msg: 'Recoverer retry failed', asId: recoverer.asId, err });
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

		const { asId } = recoverer;

		const appservice = this.registrationService.getById(asId);
		if (!appservice) {
			// Bridge was unregistered — initialize() already dropped its state doc
			// and queue; discard the recoverer without marking anything up.
			this.logger.info({ msg: 'Appservice no longer registered; discarding recoverer', asId });
			this.recoverers.delete(asId);
			return;
		}

		recoverer.retrying = true;

		try {
			for (;;) {
				// eslint-disable-next-line no-await-in-loop
				const txn = await this.txnRepo.getOldestPending(asId);
				if (!txn) {
					this.recoverers.delete(asId);
					// eslint-disable-next-line no-await-in-loop
					await this.stateRepo.markUp(asId);
					this.logger.info({ msg: 'Appservice backlog drained; marked up', asId });
					// A sender that saw 'down' may have inserted a row between the empty
					// check and markUp while this recoverer was still registered (so it
					// didn't adopt). One re-check after markUp closes that window.
					// eslint-disable-next-line no-await-in-loop
					if (await this.txnRepo.getOldestPending(asId)) {
						this.logger.info({ msg: 'Transaction arrived while marking up; resuming recovery', asId });
						this.ensureRecoverer(asId);
					}
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
				const result = await this.putTransaction(appservice, txn.txnId, this.buildBody(events));
				if (!result.sent) {
					// Keep persisted diagnostics pointing at the most recent failure; also
					// re-marks DOWN if a straggler drain is failing while the state says up.
					// eslint-disable-next-line no-await-in-loop
					await this.stateRepo.markDown(asId, `Failed to deliver transaction ${txn.txnId}: ${result.reason}`);
					this.backoffAndReschedule(recoverer);
					return;
				}

				// eslint-disable-next-line no-await-in-loop
				await this.txnRepo.complete(asId, txn.txnId);
				recoverer.backoffCounter = 1;
			}
		} catch (err) {
			// A DB error escaping the loop must never kill recovery: a dead-but-
			// registered recoverer would also block ensureRecoverer's adoption.
			this.logger.error({ msg: 'Recoverer retry failed; rescheduling', asId, err });
			if (this.recoverers.get(asId) === recoverer) {
				this.backoffAndReschedule(recoverer);
			} else {
				// Deleted mid-retry (e.g. markUp threw after the empty-queue delete) —
				// make sure someone still owns recovery.
				this.ensureRecoverer(asId);
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

	private async putTransaction(appservice: CachedAppService, txnId: number, body: Record<string, unknown>): Promise<PutResult> {
		const { registration } = appservice;

		if (!registration.url) return { sent: false, reason: 'Appservice has no URL configured' };

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
				return { sent: true };
			}

			this.logger.warn({
				msg: `Transaction delivery failed`,
				asId: registration._id,
				txnId,
				status: response.status,
			});
			return { sent: false, reason: `HTTP ${response.status}` };
		} catch (err) {
			this.logger.error({
				msg: `Transaction delivery error`,
				asId: registration._id,
				txnId,
				err,
			});
			return { sent: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}
}
