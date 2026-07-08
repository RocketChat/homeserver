import { createLogger, fetch } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import { RegistrationService } from './registration.service';

export interface PingResult {
	duration_ms: number;
}

export interface PingError {
	errcode: string;
	error: string;
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
			// with status undefined instead (see errorResponse in utils/fetch.ts).
			if (response.status === undefined) {
				return {
					errcode: 'M_CONNECTION_FAILED',
					error: 'Failed to connect to appservice',
				};
			}

			if (!response.ok) {
				return {
					errcode: 'M_BAD_STATUS',
					error: `Appservice returned HTTP ${response.status}`,
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
