import { createLogger } from '@hs/core';
import { singleton } from 'tsyringe';
import type { StagingAreaEventType } from '../queues/staging-area.queue';
import { StagingAreaQueue } from '../queues/staging-area.queue';
import { StagingAreaService } from '../services/staging-area.service';

@singleton()
export class StagingAreaListener {
	private readonly logger = createLogger('StagingAreaListener');

	constructor(
		private readonly stagingAreaQueue: StagingAreaQueue,
		private readonly stagingAreaService: StagingAreaService,
	) {
		this.stagingAreaQueue.registerHandler(this.handleQueueItem.bind(this));
	}

	async handleQueueItem(data: StagingAreaEventType) {
		// TODO: check what to do with origin
		this.logger.debug(`Processing event ${data.eventId}`);
		await this.stagingAreaService.processEvent(data);
	}
}
