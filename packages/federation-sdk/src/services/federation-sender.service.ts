import type { BaseEDU } from '@rocket.chat/federation-core';
import { createLogger } from '@rocket.chat/federation-core';
import type { Pdu } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { FederationRequestService } from './federation-request.service';
import { PerDestinationQueue } from '../queues/per-destination.queue';

/**
 * Manages outgoing queues for all destination servers.
 * Creates and maintains per-destination queues for sending PDUs and EDUs.
 */
@singleton()
export class FederationSenderService {
	private readonly logger = createLogger('FederationSenderService');

	private readonly queues = new Map<string, PerDestinationQueue>();

	constructor(private readonly configService: ConfigService, private readonly requestService: FederationRequestService) {}

	/**
	 * Send a PDU to a destination server
	 */
	sendPDU(destination: string, pdu: Pdu): void {
		if (destination === this.configService.serverName) {
			this.logger.debug({ destination }, 'Skipping PDU to local server');
			return;
		}

		const queue = this.getOrCreateQueue(destination);
		queue.enqueuePDU(pdu);
	}

	/**
	 * Send an EDU to a destination server
	 */
	sendEDU(destination: string, edu: BaseEDU): void {
		if (destination === this.configService.serverName) {
			this.logger.debug({ destination }, 'Skipping EDU to local server');
			return;
		}

		const queue = this.getOrCreateQueue(destination);
		queue.enqueueEDU(edu);
	}

	/**
	 * Send a PDU to multiple destination servers
	 */
	sendPDUToMultiple(destinations: string[], pdu: Pdu): void {
		for (const destination of destinations) {
			this.sendPDU(destination, pdu);
		}
	}

	/**
	 * Send EDUs to multiple destination servers
	 */
	sendEDUToMultiple(destinations: string[], edus: BaseEDU[]): void {
		for (const destination of destinations) {
			for (const edu of edus) {
				this.sendEDU(destination, edu);
			}
		}
	}

	/**
	 * Notify that a remote server is back online.
	 * This clears backoff and triggers immediate retry for that destination.
	 * Should be called when receiving an incoming request from the remote server.
	 */
	notifyRemoteServerUp(destination: string): void {
		const queue = this.queues.get(destination);
		if (queue) {
			this.logger.info({ destination }, 'Notifying queue that remote server is up');
			queue.notifyServerUp();
		}
	}

	/**
	 * Get or create a queue for a destination server
	 */
	private getOrCreateQueue(destination: string): PerDestinationQueue {
		let queue = this.queues.get(destination);

		if (!queue) {
			this.logger.debug({ destination }, 'Creating new queue for destination');
			queue = new PerDestinationQueue(destination, this.configService.serverName, this.requestService);
			this.queues.set(destination, queue);
		}

		return queue;
	}

	/**
	 * Graceful shutdown
	 */
	shutdown(): void {
		this.logger.info('OutgoingQueueManager shutdown complete');
	}
}
