import type { BaseEDU } from '@rocket.chat/federation-core';
import { createLogger } from '@rocket.chat/federation-core';
import type { Pdu } from '@rocket.chat/federation-room';

import type { FederationRequestService } from '../services/federation-request.service';
import { FederationEndpoints, type SendTransactionResponse, type Transaction } from '../specs/federation-api';

/**
 * Per-destination queue for sending PDUs and EDUs to a specific homeserver.
 * Implements retry logic with exponential backoff and batching of events.
 *
 * Configuration:
 * - Matrix spec constants (hardcoded):
 *   - MAX_PDUS_PER_TRANSACTION = 50
 *   - MAX_EDUS_PER_TRANSACTION = 100
 *
 * - Environment variables (configurable):
 *   - FEDERATION_OUTGOING_MAX_RETRIES: Max retry attempts (default: 10)
 *   - FEDERATION_OUTGOING_INITIAL_BACKOFF_MS: Initial backoff in milliseconds (default: 1000)
 *   - FEDERATION_OUTGOING_MAX_BACKOFF_MS: Maximum backoff in milliseconds (default: 3600000 = 1 hour)
 *   - FEDERATION_OUTGOING_BACKOFF_MULTIPLIER: Backoff multiplier for exponential backoff (default: 2)
 */

interface QueuedPDU {
	pdu: Pdu;
	queuedAt: number;
}

interface QueuedEDU {
	edu: BaseEDU;
	queuedAt: number;
}

// Matrix spec constants (hardcoded per spec)
const MAX_PDUS_PER_TRANSACTION = 50;
const MAX_EDUS_PER_TRANSACTION = 100;

interface RetryConfig {
	maxRetries: number;
	initialBackoffMs: number;
	maxBackoffMs: number;
	backoffMultiplier: number;
}

/**
 * Get retry configuration from environment variables with sensible defaults
 */
function getRetryConfigFromEnv(): RetryConfig {
	return {
		maxRetries: parseInt(process.env.FEDERATION_OUTGOING_MAX_RETRIES || '10', 10),
		initialBackoffMs: parseInt(process.env.FEDERATION_OUTGOING_INITIAL_BACKOFF_MS || '1000', 10),
		maxBackoffMs: parseInt(process.env.FEDERATION_OUTGOING_MAX_BACKOFF_MS || '3600000', 10), // 1 hour
		backoffMultiplier: parseFloat(process.env.FEDERATION_OUTGOING_BACKOFF_MULTIPLIER || '2'),
	};
}

export class PerDestinationQueue {
	private logger;

	private pduQueue: QueuedPDU[] = [];

	private eduQueue: QueuedEDU[] = [];

	private processing = false;

	private retryCount = 0;

	private nextRetryAt = 0;

	private readonly retryConfig: RetryConfig;

	constructor(
		private readonly destination: string,
		private readonly origin: string,
		private readonly requestService: FederationRequestService,
		retryConfig?: Partial<RetryConfig>,
	) {
		// Load config from env vars, allow override for testing
		const envConfig = getRetryConfigFromEnv();
		this.retryConfig = { ...envConfig, ...retryConfig };

		this.logger = createLogger('PerDestinationQueue').child({ destination });
	}

	/**
	 * Enqueue a PDU for sending to the destination
	 */
	enqueuePDU(pdu: Pdu): void {
		this.pduQueue.push({
			pdu,
			queuedAt: Date.now(),
		});
		this.logger.debug({ queueSize: this.pduQueue.length }, 'Enqueued PDU');
		this.processQueue();
	}

	/**
	 * Enqueue an EDU for sending to the destination
	 */
	enqueueEDU(edu: BaseEDU): void {
		this.eduQueue.push({
			edu,
			queuedAt: Date.now(),
		});
		this.logger.debug({ queueSize: this.eduQueue.length }, 'Enqueued EDU');
		this.processQueue();
	}

	/**
	 * Check if the queue is empty
	 */
	isEmpty(): boolean {
		return this.pduQueue.length === 0 && this.eduQueue.length === 0;
	}

	/**
	 * Notify that the remote server is back online.
	 * This clears the backoff and triggers immediate processing.
	 */
	notifyServerUp(): void {
		this.logger.info('Remote server is back online, clearing backoff');
		this.retryCount = 0;
		this.nextRetryAt = 0;

		// Trigger immediate processing if there are items in queue
		if (!this.isEmpty()) {
			this.processQueue();
		}
	}

	/**
	 * Process the queue by sending batched transactions
	 */
	private async processQueue(): Promise<void> {
		// Don't process if already processing or if we need to wait for retry
		if (this.processing) {
			return;
		}

		const now = Date.now();
		if (this.nextRetryAt > now) {
			const waitTime = this.nextRetryAt - now;
			this.logger.debug({ waitTimeMs: waitTime, nextRetryAt: this.nextRetryAt }, 'Waiting before next retry');
			setTimeout(() => this.processQueue(), waitTime);
			return;
		}

		// Don't process if queue is empty
		if (this.isEmpty()) {
			return;
		}

		this.processing = true;

		try {
			// Batch PDUs and EDUs into a transaction
			// Matrix spec: max 50 PDUs and 100 EDUs per transaction
			const pdusToSend = this.pduQueue.slice(0, MAX_PDUS_PER_TRANSACTION).map((item) => item.pdu);
			const edusToSend = this.eduQueue.slice(0, MAX_EDUS_PER_TRANSACTION).map((item) => item.edu);

			this.logger.info({ pduCount: pdusToSend.length, eduCount: edusToSend.length }, 'Sending transaction');

			await this.sendTransaction({
				origin: this.origin,
				origin_server_ts: Date.now(),
				pdus: pdusToSend,
				edus: edusToSend,
			});

			// Transaction successful, remove sent items from queue
			this.pduQueue.splice(0, pdusToSend.length);
			this.eduQueue.splice(0, edusToSend.length);

			// Reset retry count on success
			this.retryCount = 0;
			this.nextRetryAt = 0;

			this.logger.info('Successfully sent transaction');

			// Continue processing if there are more items
			if (!this.isEmpty()) {
				this.processing = false;
				this.processQueue();
			}
		} catch (error) {
			this.logger.error(
				{
					err: error,
					retryCount: this.retryCount,
				},
				'Failed to send transaction',
			);

			// Handle retry with exponential backoff
			this.handleRetry();
		} finally {
			this.processing = false;
		}
	}

	/**
	 * Send a transaction to the destination server
	 */
	private async sendTransaction(transaction: Transaction): Promise<SendTransactionResponse> {
		const txnId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const uri = FederationEndpoints.sendTransaction(txnId);

		return this.requestService.put<SendTransactionResponse>(this.destination, uri, transaction);
	}

	/**
	 * Handle retry logic with exponential backoff
	 */
	private handleRetry(): void {
		this.retryCount++;

		if (this.retryCount > this.retryConfig.maxRetries) {
			this.logger.error(
				{
					maxRetries: this.retryConfig.maxRetries,
					droppedPdus: this.pduQueue.length,
					droppedEdus: this.eduQueue.length,
				},
				'Max retries reached, dropping events',
			);
			// Clear the queue on max retries
			this.pduQueue = [];
			this.eduQueue = [];
			this.retryCount = 0;
			this.nextRetryAt = 0;
			return;
		}

		// Calculate exponential backoff
		const backoff = Math.min(
			this.retryConfig.initialBackoffMs * Math.pow(this.retryConfig.backoffMultiplier, this.retryCount - 1),
			this.retryConfig.maxBackoffMs,
		);

		// Check if backoff exceeds 1 hour threshold (per Synapse spec, should enter catch-up mode)
		if (backoff >= 3600000) {
			this.logger.warn(
				{
					destination: this.destination,
					backoffMs: backoff,
					pduQueueSize: this.pduQueue.length,
					eduQueueSize: this.eduQueue.length,
				},
				'Backoff exceeded 1 hour. Emptying queue and stop retrying until server is up.',
			);
			this.pduQueue = [];
			this.eduQueue = [];
			this.retryCount = 0;
			this.nextRetryAt = Infinity;
			return;
		}

		this.nextRetryAt = Date.now() + backoff;

		this.logger.info(
			{
				destination: this.destination,
				retryCount: this.retryCount,
				maxRetries: this.retryConfig.maxRetries,
				backoffMs: backoff,
			},
			'Scheduling retry',
		);

		// Schedule retry
		setTimeout(() => this.processQueue(), backoff);
	}
}
