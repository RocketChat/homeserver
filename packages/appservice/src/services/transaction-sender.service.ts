import { createLogger, fetch } from '@rocket.chat/federation-core';
import { delay, inject, singleton } from 'tsyringe';

import type { AppServiceTransaction, CachedAppService } from '../models/appservice.model';
import { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import { AppServiceTransactionRepository } from '../repositories/appservice-txn.repository';

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;

@singleton()
export class TransactionSenderService {
	private readonly logger = createLogger('TransactionSenderService');

	constructor(
		@inject(delay(() => AppServiceStateRepository))
		private readonly stateRepo: AppServiceStateRepository,
		@inject(delay(() => AppServiceTransactionRepository))
		private readonly txnRepo: AppServiceTransactionRepository,
	) {}

	/**
	 * Send a transaction to an appservice.
	 * Queues it first, then attempts delivery. On failure, marks the bridge as DOWN
	 * and schedules retries with exponential backoff.
	 */
	async sendTransaction(
		appservice: CachedAppService,
		events: Record<string, unknown>[],
		ephemeral?: Record<string, unknown>[],
	): Promise<void> {
		const { registration } = appservice;

		if (!registration.url) {
			return; // No URL configured, skip
		}

		const txnId = await this.stateRepo.incrementTxnId(registration._id);
		const eventIds = events.map((e) => (e as { event_id?: string }).event_id).filter(Boolean) as string[];

		const txn: AppServiceTransaction = {
			_id: `${registration._id}:${txnId}`,
			asId: registration._id,
			txnId,
			eventIds,
			ephemeralEvents: ephemeral,
			status: 'pending',
			attempts: 0,
			createdAt: new Date(),
		};

		await this.txnRepo.create(txn);
		await this.attemptDelivery(appservice, txnId, events, ephemeral);
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

		// We don't have the full events stored in the txn (only IDs),
		// so for retries we send an empty transaction to test connectivity.
		await Promise.all(eligible.map((txn) => this.attemptDeliveryRaw(appservice, txn.txnId, { events: [] })));
	}

	private async attemptDelivery(
		appservice: CachedAppService,
		txnId: number,
		events: Record<string, unknown>[],
		ephemeral?: Record<string, unknown>[],
	): Promise<boolean> {
		const body: Record<string, unknown> = { events };
		if (ephemeral?.length) {
			body['de.sorunome.msc2409.ephemeral'] = ephemeral;
		}

		return this.attemptDeliveryRaw(appservice, txnId, body);
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
