import { createLogger, fetch } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import { RegistrationService } from './registration.service';

export interface PingResult {
	duration_ms: number;
}

export interface PingError {
	errcode: 'M_NOT_FOUND' | 'M_URL_NOT_SET' | 'M_BAD_STATUS' | 'M_CONNECTION_TIMEOUT' | 'M_CONNECTION_FAILED';
	error: string;
	// MSC2659: M_BAD_STATUS responses carry the bridge's status and body.
	status?: number;
	body?: string;
}

@singleton()
export class PingService {
	private readonly logger = createLogger('PingService');

	constructor(private readonly registrationService: RegistrationService) {}

	/**
	 * Ping an appservice to check connectivity.
	 * The homeserver sends POST /_matrix/app/v1/ping to the bridge.
	 */
	async ping(asId: string, transactionId?: string): Promise<PingResult | PingError> {
		const as = this.registrationService.getById(asId);
		if (!as) {
			return { errcode: 'M_NOT_FOUND', error: `Appservice ${asId} not found` };
		}

		if (!as.registration.url) {
			return { errcode: 'M_URL_NOT_SET', error: 'Appservice URL is not set' };
		}

		const url = new URL(`${as.registration.url}/_matrix/app/v1/ping`);
		const startTime = Date.now();

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${as.registration.hsToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					transaction_id: transactionId ?? `ping-${Date.now()}`,
				}),
			});

			const durationMs = Date.now() - startTime;

			// The core fetch helper never rejects on transport errors — it resolves
			// with status undefined, and the failure reason is only retrievable
			// through the rejecting body accessors (see errorResponse in utils/fetch.ts).
			if (response.status === undefined) {
				const reason = await response.text().catch((r) => String(r));
				// Covers the fetch wrapper's inactivity timeout ("Request timed out
				// after 20s") plus Node transport timeouts ("connect ETIMEDOUT ...",
				// "Socket connection timeout").
				if (/timed out|timeout|ETIMEDOUT/i.test(reason)) {
					return { errcode: 'M_CONNECTION_TIMEOUT', error: reason };
				}
				return { errcode: 'M_CONNECTION_FAILED', error: reason || 'Failed to connect to appservice' };
			}

			if (!response.ok) {
				return {
					errcode: 'M_BAD_STATUS',
					error: `Appservice returned HTTP ${response.status}`,
					status: response.status,
					body: await response.text().catch(() => ''),
				};
			}

			return { duration_ms: durationMs };
		} catch (err) {
			return {
				errcode: 'M_CONNECTION_FAILED',
				error: err instanceof Error ? err.message : 'Connection failed',
			};
		}
	}
}
